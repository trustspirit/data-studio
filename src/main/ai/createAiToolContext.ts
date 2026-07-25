import type { Actor } from '../core/execution/Actor'
import type { OperationExecutor } from '../core/execution/OperationExecutor'
import type { WriteProposalStore } from '../core/execution/WriteProposalStore'
import type { ConnectionRepository } from '../core/ports/ConnectionRepository'
import type { PiiRedactor } from './PiiRedactor'
import type { AiToolContext } from './AiToolContext'

export interface AiToolContextDeps {
  readonly executor: OperationExecutor
  readonly connections: Pick<ConnectionRepository, 'list' | 'get'>
  readonly proposals: WriteProposalStore
  readonly redactor: PiiRedactor
  readonly sessionId: string
  readonly newRequestId: () => string
}

/**
 * 한 AI 세션의 tool 실행 컨텍스트를 만든다.
 *
 * **`aiActor()`가 여기서 `{type:'ai', sessionId}`로 하드와이어된다** — 이 factory가
 * AI actor의 유일한 생성 지점이다. renderer/preload/IPC는 Actor를 만들 수 없고
 * (boundaries 테스트가 강제), tool은 `ctx.aiActor()`만 부른다. 따라서 AI 권한은
 * 오직 이 경로로만 부여된다.
 */
export function createAiToolContext(deps: AiToolContextDeps): AiToolContext {
  const aiActor = (): Actor => ({ type: 'ai', sessionId: deps.sessionId })
  return {
    executor: deps.executor,
    connections: deps.connections,
    proposals: deps.proposals,
    redactor: deps.redactor,
    sessionId: deps.sessionId,
    newRequestId: deps.newRequestId,
    aiActor,
  }
}
