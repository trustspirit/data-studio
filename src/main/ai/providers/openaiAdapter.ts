import OpenAI from 'openai'
import type { SecretStore } from '../../core/ports/SecretStore'
import { LlmApiKeyMissingError } from './anthropicAdapter'
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

const DEFAULT_MODEL = 'gpt-4o'

/** 어댑터가 소비하는 정규화 스트림 이벤트. defaultCreateClient가 SDK 청크를 이걸로 옮긴다. */
export type OpenAiStreamEvent =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'tool_use'; readonly id: string; readonly name: string; readonly input: unknown }
  | { readonly type: 'stop'; readonly finishReason: string }

export interface OpenAiStreamParams {
  readonly model: string
  readonly messages: unknown
  readonly tools: unknown
}

export interface OpenAiClientLike {
  stream(params: OpenAiStreamParams): AsyncIterable<OpenAiStreamEvent>
}

export interface OpenAiDeps {
  readonly secrets: SecretStore
  readonly createClient?: (apiKey: string) => OpenAiClientLike
}

export function toOpenAiTools(tools: readonly LlmToolSpec[]): unknown[] {
  return tools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.inputSchema },
  }))
}

export function toOpenAiMessages(messages: readonly ChatMessage[]): unknown[] {
  return messages.map((m) => {
    if (m.role === 'user') return { role: 'user', content: m.text }
    if (m.role === 'assistant') {
      return {
        role: 'assistant',
        content: m.text === '' ? null : m.text,
        ...(m.toolUses.length === 0
          ? {}
          : {
              tool_calls: m.toolUses.map((u) => ({
                id: u.id,
                type: 'function',
                function: { name: u.name, arguments: JSON.stringify(u.input) },
              })),
            }),
      }
    }
    // tool_result는 OpenAI에서 role:tool 메시지로 보낸다.
    return { role: 'tool', tool_call_id: m.toolUseId, content: m.content }
  })
}

export function mapOpenAiFinishReason(raw: string): StopReason {
  if (raw === 'tool_calls') return 'tool_use'
  if (raw === 'length') return 'max_tokens'
  return 'end'
}

/**
 * `delta.tool_calls[]` 조각(index별로 id/function.name/function.arguments가
 * 여러 청크에 걸쳐 나뉘어 온다)을 누적하는 상태.
 */
interface PendingToolCall {
  id: string
  name: string
  arguments: string
}

/**
 * 실제 `openai` SDK 스트리밍 청크(`ChatCompletionChunk`)를 좁은
 * `OpenAiStreamEvent` 유니온으로 변환한다.
 *
 * 청크 형태는 설치된 SDK(`openai` 6.49.0)의
 * `resources/chat/completions/completions.d.ts`에서 확인했다:
 * - `choices[0].delta.content`: 텍스트 델타(string | null | undefined)
 * - `choices[0].delta.tool_calls[]`: `{ index, id?, function?: { name?, arguments? } }` —
 *   OpenAI는 tool call을 index로 여러 청크에 걸쳐 조각내어 보낸다. id/name은 첫 조각에서
 *   오고, arguments는 이후 청크들에 걸쳐 문자열로 누적된다.
 * - `choices[0].finish_reason`: 턴 종료 사유(non-null일 때만 방출) — 이 시점에 아직 방출
 *   되지 않은 누적 tool_call들을 먼저 tool_use로 flush한다.
 */
async function* mapOpenAiStream(
  stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>,
): AsyncGenerator<OpenAiStreamEvent> {
  const pendingToolCalls = new Map<number, PendingToolCall>()

  function flushToolCall(index: number): OpenAiStreamEvent | undefined {
    const pending = pendingToolCalls.get(index)
    if (pending === undefined) return undefined
    pendingToolCalls.delete(index)
    let input: unknown = {}
    if (pending.arguments !== '') {
      try {
        input = JSON.parse(pending.arguments) as unknown
      } catch {
        input = {}
      }
    }
    return { type: 'tool_use', id: pending.id, name: pending.name, input }
  }

  for await (const chunk of stream) {
    const choice = chunk.choices[0]
    if (choice === undefined) continue

    const content = choice.delta.content
    if (content !== null && content !== undefined && content !== '') {
      yield { type: 'text', text: content }
    }

    const toolCallDeltas = choice.delta.tool_calls
    if (toolCallDeltas !== undefined) {
      for (const delta of toolCallDeltas) {
        const existing = pendingToolCalls.get(delta.index)
        if (existing === undefined) {
          pendingToolCalls.set(delta.index, {
            id: delta.id ?? '',
            name: delta.function?.name ?? '',
            arguments: delta.function?.arguments ?? '',
          })
        } else {
          if (delta.id !== undefined) existing.id = delta.id
          if (delta.function?.name !== undefined) existing.name = delta.function.name
          if (delta.function?.arguments !== undefined) existing.arguments += delta.function.arguments
        }
      }
    }

    if (choice.finish_reason !== null) {
      for (const index of [...pendingToolCalls.keys()]) {
        const event = flushToolCall(index)
        if (event !== undefined) yield event
      }
      yield { type: 'stop', finishReason: choice.finish_reason }
    }
  }
}

function defaultCreateClient(apiKey: string): OpenAiClientLike {
  const client = new OpenAI({ apiKey })
  return {
    stream: (params) => {
      const messages = params.messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[]
      const tools = params.tools as OpenAI.Chat.Completions.ChatCompletionTool[]
      const sdkStreamPromise = client.chat.completions.create({
        model: params.model,
        stream: true,
        messages,
        tools,
      })
      return (async function* (): AsyncGenerator<OpenAiStreamEvent> {
        const sdkStream = await sdkStreamPromise
        yield* mapOpenAiStream(sdkStream)
      })()
    },
  }
}

/**
 * OpenAI LlmProvider(function calling). **tool을 실행하지 않는다** — 어시스턴트 1턴을
 * 스트리밍하고 tool_use 요청을 반환할 뿐이다. thinking 없음(onThinking 미호출).
 * cache_control 없음(OpenAI가 자동 캐싱). 기본 모델 gpt-4o.
 */
export function createOpenAiProvider(deps: OpenAiDeps): LlmProvider {
  const create = deps.createClient ?? defaultCreateClient
  return {
    id: 'openai',
    chat: async (req: ChatRequest, sink: ChatSink): Promise<ChatTurnResult> => {
      const apiKey = await deps.secrets.get({ kind: 'llm-api-key', ownerId: 'openai' })
      if (apiKey === null) throw new LlmApiKeyMissingError('openai')
      const client = create(apiKey)

      const params: OpenAiStreamParams = {
        model: req.model ?? DEFAULT_MODEL,
        messages: [{ role: 'system', content: req.system }, ...toOpenAiMessages(req.messages)],
        tools: toOpenAiTools(req.tools),
      }

      let text = ''
      const toolUses: ToolUse[] = []
      let stopReason: StopReason = 'end'

      for await (const event of client.stream(params)) {
        if (event.type === 'text') {
          text += event.text
          sink.onText(event.text)
        } else if (event.type === 'tool_use') {
          const use: ToolUse = { id: event.id, name: event.name, input: event.input }
          toolUses.push(use)
          sink.onToolUse(use)
        } else {
          stopReason = mapOpenAiFinishReason(event.finishReason)
        }
      }

      return { text, toolUses, stopReason }
    },
  }
}
