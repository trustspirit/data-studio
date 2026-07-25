import type { AiStreamEvent } from '@shared/contracts/aiEvents'
import type {
  ChatSink,
  LlmProvider,
  ProviderId,
  ToolUse,
} from '../core/ports/LlmProvider'
import type { OperationExecutor } from '../core/execution/OperationExecutor'
import type { WriteProposalStore } from '../core/execution/WriteProposalStore'
import type { ConnectionRepository } from '../core/ports/ConnectionRepository'
import type { PiiRedactor } from './PiiRedactor'
import { AiOrchestrator } from './AiOrchestrator'
import { buildToolRegistry } from './buildToolRegistry'
import { createAiToolContext } from './createAiToolContext'
import { formatSchema } from './context/SchemaContextBuilder'
import { LlmApiKeyMissingError } from './providers/anthropicAdapter'

/** main→renderer로 AI 스트림 이벤트를 미는 포트. index.ts가 `ai:event` send로 배선한다. */
export type AiPushPort = (sessionId: string, event: AiStreamEvent) => void

export type SendOutcome =
  | { readonly accepted: true }
  | { readonly accepted: false; readonly reason: string }

export interface AiSessionManagerDeps {
  /** 조립된 프로바이더들. 키가 없으면 그 프로바이더로는 세션을 못 연다. */
  readonly providers: Partial<Record<ProviderId, LlmProvider>>
  readonly executor: OperationExecutor
  readonly connections: Pick<ConnectionRepository, 'list' | 'get'>
  readonly proposals: WriteProposalStore
  readonly redactor: PiiRedactor
  readonly randomId: () => string
  readonly systemPrompt: string
  readonly push: AiPushPort
  readonly maxRounds?: number
}

interface Session {
  readonly orchestrator: AiOrchestrator
  /** in-flight sendMessage의 취소 컨트롤러. null이면 유휴. */
  controller: AbortController | null
}

/**
 * AI 채팅 세션의 수명을 관리한다. 세션마다 오케스트레이터 하나(대화 이력 보유)와
 * tool 컨텍스트 하나(AI actor의 sessionId 고정)를 만든다.
 *
 * `send`는 **기다리지 않는다** — 스트리밍은 push 포트로 나가므로 IPC 핸들러가
 * 응답을 붙들 이유가 없다. 세션당 in-flight 1개만 허용하고, 진행 중이면
 * `accepted:false`를 즉시 돌려준다.
 */
export class AiSessionManager {
  private readonly sessions = new Map<string, Session>()

  constructor(private readonly deps: AiSessionManagerDeps) {}

  /**
   * 새 세션을 연다. 스키마 컨텍스트(캐시 프리픽스)는 세션 시작 시점의 커넥션
   * 목록으로 굳힌다 — 테이블 상세는 LLM이 get_schema tool로 필요할 때 가져온다.
   */
  async createSession(provider: ProviderId): Promise<{ sessionId: string }> {
    const llm = this.deps.providers[provider]
    if (llm === undefined) throw new Error(`provider not available: ${provider}`)

    const sessionId = this.deps.randomId()
    const toolContext = createAiToolContext({
      executor: this.deps.executor,
      connections: this.deps.connections,
      proposals: this.deps.proposals,
      redactor: this.deps.redactor,
      sessionId,
      newRequestId: this.deps.randomId,
    })

    const orchestrator = new AiOrchestrator({
      provider: llm,
      toolRegistry: buildToolRegistry(),
      toolContext,
      systemPrompt: this.deps.systemPrompt,
      schemaContext: await this.buildSchemaContext(),
      ...(this.deps.maxRounds === undefined ? {} : { maxRounds: this.deps.maxRounds }),
    })

    this.sessions.set(sessionId, { orchestrator, controller: null })
    return { sessionId }
  }

  send(sessionId: string, text: string): SendOutcome {
    const session = this.sessions.get(sessionId)
    if (session === undefined) return { accepted: false, reason: `unknown session: ${sessionId}` }
    if (session.controller !== null) return { accepted: false, reason: 'session busy' }

    const controller = new AbortController()
    session.controller = controller
    const sink = this.buildSink(sessionId)

    // 오케스트레이터는 정상 종료를 sink.onDone/onError로 알린다. 여기 catch는
    // provider.chat이 던지는 경우(키 없음, 네트워크)만 잡는다.
    void session.orchestrator
      .sendMessage(text, sink, controller.signal)
      .catch((error: unknown) => {
        // 원문 예외는 renderer에 새지 않게 한다 — 키 없음만 구체적으로 알린다.
        const message =
          error instanceof LlmApiKeyMissingError ? error.message : 'ai request failed'
        sink.onError(message)
      })
      .finally(() => {
        if (session.controller === controller) session.controller = null
      })

    return { accepted: true }
  }

  cancel(sessionId: string): void {
    this.sessions.get(sessionId)?.controller?.abort()
  }

  private buildSink(sessionId: string): ChatSink {
    const push = (event: AiStreamEvent): void => this.deps.push(sessionId, event)
    return {
      onText: (delta: string) => push({ type: 'text', delta }),
      onThinking: (delta: string) => push({ type: 'thinking', delta }),
      // tool 입력(SQL 원문 등)은 스트림에 싣지 않는다 — aiEvents 계약 참고.
      onToolUse: (use: ToolUse) => push({ type: 'tool_use', name: use.name }),
      onDone: () => push({ type: 'done' }),
      onError: (message: string) => push({ type: 'error', message }),
    }
  }

  private async buildSchemaContext(): Promise<string> {
    const configs = await this.deps.connections.list()
    return formatSchema({
      connections: configs.map((c) => ({ id: c.id, name: c.name, engine: c.engine, tables: [] })),
    })
  }
}
