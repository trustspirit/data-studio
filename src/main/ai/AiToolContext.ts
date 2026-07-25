import type { Actor } from '../core/execution/Actor'
import type { OperationExecutor } from '../core/execution/OperationExecutor'
import type { WriteProposalStore } from '../core/execution/WriteProposalStore'
import type { ConnectionRepository } from '../core/ports/ConnectionRepository'
import type { PiiRedactor } from './PiiRedactor'

/**
 * tool이 의존하는 협력자. **AI actor는 오직 여기 `aiActor()`로만 만들어진다** —
 * renderer/preload/IPC 어디에서도 AI actor를 만들 수 없다(ipcRoutes는 user actor만).
 * 이 성질이 §4.3 신뢰 경계의 핵심이다.
 */
export interface AiToolContext {
  readonly executor: OperationExecutor
  readonly connections: Pick<ConnectionRepository, 'list' | 'get'>
  readonly proposals: WriteProposalStore
  readonly redactor: PiiRedactor
  readonly sessionId: string
  /** 이 세션의 AI actor. */
  aiActor(): Actor
  /** OperationRequest용 새 requestId(주입해 테스트 결정성 확보). */
  newRequestId(): string
}
