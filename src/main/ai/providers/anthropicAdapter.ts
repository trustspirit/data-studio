import Anthropic from '@anthropic-ai/sdk'
import type { SecretStore } from '../../core/ports/SecretStore'
import type {
  ChatMessage,
  ChatRequest,
  ChatSink,
  ChatTurnResult,
  LlmProvider,
  LlmToolSpec,
  StopReason,
  ToolUse,
} from '../../core/ports/LlmProvider'

const DEFAULT_MODEL = 'claude-opus-4-8'
const DEFAULT_MAX_TOKENS = 8192

export class LlmApiKeyMissingError extends Error {
  constructor(providerId: string) {
    super(`missing api key for provider ${providerId}`)
    this.name = 'LlmApiKeyMissingError'
  }
}

/** 어댑터가 소비하는 정규화 스트림 이벤트. defaultCreateClient가 SDK 이벤트를 이걸로 옮긴다. */
export type AnthropicStreamEvent =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'thinking'; readonly text: string }
  | { readonly type: 'tool_use'; readonly id: string; readonly name: string; readonly input: unknown }
  | { readonly type: 'stop'; readonly stopReason: string }

export interface AnthropicStreamParams {
  readonly model: string
  readonly maxTokens: number
  readonly system: unknown
  readonly messages: unknown
  readonly tools: unknown
}

export interface AnthropicClientLike {
  stream(params: AnthropicStreamParams): AsyncIterable<AnthropicStreamEvent>
}

export interface AnthropicDeps {
  readonly secrets: SecretStore
  readonly createClient?: (apiKey: string) => AnthropicClientLike
}

export function toAnthropicTools(tools: readonly LlmToolSpec[]): unknown[] {
  return tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema }))
}

export function toAnthropicMessages(messages: readonly ChatMessage[]): unknown[] {
  return messages.map((m) => {
    if (m.role === 'user') return { role: 'user', content: [{ type: 'text', text: m.text }] }
    if (m.role === 'assistant') {
      const content: unknown[] = []
      if (m.text !== '') content.push({ type: 'text', text: m.text })
      for (const u of m.toolUses) content.push({ type: 'tool_use', id: u.id, name: u.name, input: u.input })
      return { role: 'assistant', content }
    }
    // tool_result는 Anthropic에서 user 역할 메시지로 보낸다.
    return {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: m.toolUseId, content: m.content, is_error: m.isError }],
    }
  })
}

export function mapStopReason(raw: string): StopReason {
  if (raw === 'tool_use') return 'tool_use'
  if (raw === 'max_tokens') return 'max_tokens'
  return 'end'
}

/**
 * tool_use 블록의 부분 JSON(`input_json_delta`)을 블록 인덱스별로 누적하는 상태.
 * `content_block_start`에서 열고, `content_block_stop`에서 파싱해 방출한다.
 */
interface PendingToolUse {
  readonly id: string
  readonly name: string
  json: string
}

/**
 * 실제 `@anthropic-ai/sdk` 스트리밍 이벤트(`content_block_start`/`_delta`/`_stop`,
 * `message_delta`)를 좁은 `AnthropicStreamEvent` 유니온으로 변환한다.
 *
 * 이벤트 형태는 설치된 SDK(`@anthropic-ai/sdk` 0.115.0)의
 * `resources/messages/messages.d.ts`에서 확인했다:
 * - `content_block_delta.delta`: `text_delta{text}` | `thinking_delta{thinking}` | `input_json_delta{partial_json}` (+citations/signature, 무시)
 * - `content_block_start.content_block`: `tool_use` 블록이면 `{id, name}` — input은 델타로 누적
 * - `content_block_stop`: 누적된 tool_use가 있으면 JSON.parse해 완성된 tool_use로 방출
 * - `message_delta.delta.stop_reason`: 턴 종료 사유(non-null일 때만 방출)
 */
async function* mapAnthropicStream(
  stream: AsyncIterable<Anthropic.RawMessageStreamEvent>,
): AsyncGenerator<AnthropicStreamEvent> {
  const pendingToolUses = new Map<number, PendingToolUse>()

  for await (const event of stream) {
    switch (event.type) {
      case 'content_block_start': {
        const block = event.content_block
        if (block.type === 'tool_use') {
          pendingToolUses.set(event.index, { id: block.id, name: block.name, json: '' })
        }
        break
      }
      case 'content_block_delta': {
        const delta = event.delta
        if (delta.type === 'text_delta') {
          yield { type: 'text', text: delta.text }
        } else if (delta.type === 'thinking_delta') {
          yield { type: 'thinking', text: delta.thinking }
        } else if (delta.type === 'input_json_delta') {
          const pending = pendingToolUses.get(event.index)
          if (pending !== undefined) pending.json += delta.partial_json
        }
        break
      }
      case 'content_block_stop': {
        const pending = pendingToolUses.get(event.index)
        if (pending !== undefined) {
          pendingToolUses.delete(event.index)
          let input: unknown = {}
          if (pending.json !== '') {
            try {
              input = JSON.parse(pending.json) as unknown
            } catch {
              input = {}
            }
          }
          yield { type: 'tool_use', id: pending.id, name: pending.name, input }
        }
        break
      }
      case 'message_delta': {
        const stopReason = event.delta.stop_reason
        if (stopReason !== null) yield { type: 'stop', stopReason }
        break
      }
      default:
        break
    }
  }
}

function defaultCreateClient(apiKey: string): AnthropicClientLike {
  const anthropic = new Anthropic({ apiKey })
  return {
    stream: (params) => {
      const system = params.system as string | Anthropic.TextBlockParam[]
      const messages = params.messages as Anthropic.MessageParam[]
      const tools = params.tools as Anthropic.ToolUnion[]
      const sdkStream = anthropic.messages.stream({
        model: params.model,
        max_tokens: params.maxTokens,
        system,
        messages,
        tools,
        thinking: { type: 'adaptive', display: 'summarized' },
      })
      return mapAnthropicStream(sdkStream)
    },
  }
}

/**
 * Anthropic LlmProvider. **tool을 실행하지 않는다** — 어시스턴트 1턴을 스트리밍하고
 * tool_use 요청을 반환한다. cache_control(스키마 프리픽스)·thinking(adaptive/summarized)·
 * 기본 모델 claude-opus-4-8을 적용한다.
 */
export function createAnthropicProvider(deps: AnthropicDeps): LlmProvider {
  const create = deps.createClient ?? defaultCreateClient
  return {
    id: 'anthropic',
    chat: async (req: ChatRequest, sink: ChatSink): Promise<ChatTurnResult> => {
      const apiKey = await deps.secrets.get({ kind: 'llm-api-key', ownerId: 'anthropic' })
      if (apiKey === null) throw new LlmApiKeyMissingError('anthropic')
      const client = create(apiKey)

      const params: AnthropicStreamParams = {
        model: req.model ?? DEFAULT_MODEL,
        maxTokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
        system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
        messages: toAnthropicMessages(req.messages),
        tools: toAnthropicTools(req.tools),
      }

      let text = ''
      const toolUses: ToolUse[] = []
      let stopReason: StopReason = 'end'

      for await (const event of client.stream(params)) {
        if (event.type === 'text') {
          text += event.text
          sink.onText(event.text)
        } else if (event.type === 'thinking') {
          sink.onThinking(event.text)
        } else if (event.type === 'tool_use') {
          const use: ToolUse = { id: event.id, name: event.name, input: event.input }
          toolUses.push(use)
          sink.onToolUse(use)
        } else {
          stopReason = mapStopReason(event.stopReason)
        }
      }

      return { text, toolUses, stopReason }
    },
  }
}
