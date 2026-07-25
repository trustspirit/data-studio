import type {
  ChatMessage,
  ChatRequest,
  ChatSink,
  LlmProvider,
} from '../core/ports/LlmProvider'
import type { ToolRegistry } from './ToolRegistry'
import type { AiToolContext } from './AiToolContext'
import type { ToolResult } from './AiTool'

/** §4.4 AI 결과 컨텍스트 상한. */
export const AI_CONTEXT_MAX_BYTES = 100 * 1024
const DEFAULT_MAX_ROUNDS = 8

/**
 * tool 결과를 LLM에 되먹일 문자열로 만든다. **모든 tool 출력은 이 상한을 거친다** —
 * 6a run_read_query가 이미 redaction+bound하지만, 오케스트레이터가 explain_query
 * 등 모든 tool 출력에 일괄 byte 상한을 적용한다.
 */
export function boundToolResult(result: ToolResult): string {
  const raw = JSON.stringify(result.ok ? result.data : { error: result.error })
  if (raw.length <= AI_CONTEXT_MAX_BYTES) return raw
  return raw.slice(0, AI_CONTEXT_MAX_BYTES) + '…[truncated]'
}

export interface AiOrchestratorDeps {
  readonly provider: LlmProvider
  readonly toolRegistry: ToolRegistry
  readonly toolContext: AiToolContext
  readonly systemPrompt: string
  readonly schemaContext: string
  readonly maxRounds?: number
}

/**
 * tool-use 루프의 소유자. `LlmProvider.chat`은 어시스턴트 1턴만 하고, 이 클래스가
 * tool_use 요청을 받아 **`toolRegistry.invoke`(6a OperationExecutor 관문)로 실행**한
 * 뒤 결과를 되먹여 반복한다. provider/SDK는 tool을 실행하지 않는다 — 그래야
 * actor·정책·감사·redaction·쓰기 승인이 모두 관문에서 적용된다.
 *
 * per-session stateful: `messages`에 대화 이력을 누적한다.
 */
export class AiOrchestrator {
  private readonly messages: ChatMessage[] = []
  private readonly maxRounds: number

  constructor(private readonly deps: AiOrchestratorDeps) {
    this.maxRounds = deps.maxRounds ?? DEFAULT_MAX_ROUNDS
  }

  async sendMessage(userText: string, sink: ChatSink, signal?: AbortSignal): Promise<void> {
    this.messages.push({ role: 'user', text: userText })

    for (let round = 0; round < this.maxRounds; round += 1) {
      if (signal?.aborted === true) {
        sink.onError('cancelled')
        return
      }

      const req: ChatRequest = {
        system: this.deps.schemaContext === '' ? this.deps.systemPrompt : `${this.deps.systemPrompt}\n${this.deps.schemaContext}`,
        messages: this.messages,
        tools: this.deps.toolRegistry.specs(),
      }

      const turn = await this.deps.provider.chat(req, sink)
      this.messages.push({ role: 'assistant', text: turn.text, toolUses: turn.toolUses })

      if (turn.stopReason !== 'tool_use') {
        if (turn.stopReason === 'error') sink.onError('provider error')
        else sink.onDone()
        return
      }

      for (const use of turn.toolUses) {
        const result = await this.deps.toolRegistry.invoke(use.name, use.input, this.deps.toolContext)
        this.messages.push({
          role: 'tool_result',
          toolUseId: use.id,
          content: boundToolResult(result),
          isError: !result.ok,
        })
      }
    }

    // 상한까지 돌았는데 아직 tool_use만 나온다 — 폭주 방지로 끝낸다.
    sink.onError('max tool rounds exceeded')
  }
}
