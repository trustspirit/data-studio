import type { Logger } from '../core/ports/Logger'
import type { SecretStore } from '../core/ports/SecretStore'
import type { ConnectionRepository } from '../core/ports/ConnectionRepository'
import type { FileDialog } from '../core/ports/FileDialog'
import type { OperationLog } from '../core/execution/OperationLog'
import type { ExecutorClock } from '../core/execution/OperationExecutor'
import { DriverRegistry } from '../core/driver/DriverRegistry'
import { OperationExecutor } from '../core/execution/OperationExecutor'
import {
  PooledConnectionManager,
  type PoolOptions,
} from '../infrastructure/connection/PooledConnectionManager'
import { WriteProposalStore } from '../core/execution/WriteProposalStore'
import { SqlCapabilityExecutor } from '../infrastructure/execution/SqlCapabilityExecutor'
import { SchemaCapabilityExecutor } from '../infrastructure/execution/SchemaCapabilityExecutor'
import { DataCapabilityExecutor } from '../infrastructure/execution/DataCapabilityExecutor'
import { DocumentCapabilityExecutor } from '../infrastructure/execution/DocumentCapabilityExecutor'

/**
 * IPC 라우트가 쓰는 조립된 서비스들.
 */
export interface AppServices {
  readonly executor: OperationExecutor
  readonly connections: PooledConnectionManager
  readonly registry: DriverRegistry
  readonly repository: ConnectionRepository
  readonly secrets: SecretStore
  readonly log: OperationLog
  readonly proposals: WriteProposalStore
  /** 만료된 제안서를 버린다. index.ts가 이걸 주기적으로 부른다. */
  readonly sweepProposals: () => void
  readonly fileDialog: FileDialog
}

export interface AppDeps {
  readonly logger: Logger
  readonly repository: ConnectionRepository
  readonly secrets: SecretStore
  readonly log: OperationLog
  readonly fileDialog: FileDialog
  readonly clock: ExecutorClock
  readonly randomId: () => string
  readonly hash: (text: string) => string
  readonly pool: PoolOptions
  /** 개발용 인메모리 드라이버 등을 등록하는 훅. 실드라이버는 Phase 1+에서. */
  readonly registerDrivers?: (registry: DriverRegistry) => void
}

/**
 * 실행 스택을 조립한다.
 *
 * **electron을 import하지 않는 순수 팩토리다.** electron을 여기서 쓰면 이 조립
 * 로직을 유닛 테스트할 수 없다. `src/main/index.ts`가 실제 경로·clock·safeStorage로
 * 협력자를 만들어 넘기고, 이 파일은 electron 없이 전부 테스트된다.
 *
 * 이 단계에는 등록할 실드라이버가 없다 — `registerDrivers`를 주지 않으면
 * 레지스트리는 비어 있고, `open`은 `UnsupportedEngineError`가 되어 UI가 그것을
 * 표시해야 한다. 이는 의도된 상태다: 관문·커넥션·감사 계층을 먼저 배선하고,
 * 엔진은 Phase 1부터 붙인다.
 */
export function buildAppServices(deps: AppDeps): AppServices {
  const registry = new DriverRegistry()
  deps.registerDrivers?.(registry)

  const connections = new PooledConnectionManager(registry, deps.logger, deps.pool)

  const proposals = new WriteProposalStore({
    now: deps.clock.now,
    randomId: deps.randomId,
    hash: deps.hash,
  })

  const executor = new OperationExecutor(
    connections,
    deps.log,
    [
      new SqlCapabilityExecutor(),
      new SchemaCapabilityExecutor(),
      new DataCapabilityExecutor(),
      new DocumentCapabilityExecutor(),
    ],
    deps.clock,
    proposals,
  )

  return {
    executor,
    connections,
    registry,
    repository: deps.repository,
    secrets: deps.secrets,
    log: deps.log,
    proposals,
    // 순수 팩토리는 타이머를 걸지 않는다. 인터벌 설정은 index.ts의 몫이다.
    sweepProposals: () => proposals.sweep(),
    fileDialog: deps.fileDialog,
  }
}
