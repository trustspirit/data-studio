import type { AppServices } from './compositionRoot'
import type { ContractChannel, ContractInput } from '../../shared/contracts/ipcContract'
import type { CallerContext } from '../ipc/CallerContext'
import type { Actor } from '../core/execution/Actor'
import type {
  ExecutionLimits,
  Operation,
  OperationRequest,
} from '../../shared/types/operation'

/**
 * 계약 채널을 핸들러에 연결하는 register. `createContractRegistrar`의 반환형이다.
 */
export type ContractRegister = <C extends ContractChannel, O>(
  channel: C,
  handler: (input: ContractInput<C>, context: CallerContext) => Promise<O>,
) => void

/**
 * IPC 채널을 서비스에 연결한다.
 *
 * **여기서 actor가 태어난다.** 이 경로로 들어오는 모든 호출은 renderer/preload를
 * 거치므로 언제나 `{ type: 'user' }`다. AI actor(`{ type: 'ai' }`)는 오직 AI
 * 오케스트레이터(Phase 6)만 만들며, 이 파일에는 그 경로가 없다. renderer는
 * actor를 보낼 수 없다 — 계약 스키마에 actor 필드가 없어 위조해도 strip된다.
 *
 * 승인 토큰(`proposalId`)이 있으면 `{ type: 'user', grant: { proposalId } }`를,
 * 없으면 `{ type: 'user', grant: null }`를 만든다.
 */
export function registerIpcRoutes(register: ContractRegister, services: AppServices): void {
  register('connection:list', () => services.repository.list())

  register('connection:save', async (config) => {
    await services.repository.save(config)
    return null
  })

  register('connection:delete', async ({ id }) => {
    await services.repository.delete(id)
    // 연결이 사라지면 그 비밀도 지운다 — 고아 비밀 방지.
    await services.secrets.delete({ kind: 'db-password', ownerId: id })
    return null
  })

  register('connection:open', async ({ connectionId }) => {
    const config = await services.repository.get(connectionId)
    if (config === null) return { opened: false as const, reason: `unknown connection: ${connectionId}` }
    try {
      await services.connections.open(config)
      return { opened: true as const }
    } catch (error) {
      return { opened: false as const, reason: error instanceof Error ? error.message : String(error) }
    }
  })

  register('connection:close', async ({ connectionId }) => {
    await services.connections.close(connectionId)
    return null
  })

  register('connection:status', ({ connectionId }) =>
    Promise.resolve({ status: services.connections.status(connectionId) }),
  )

  register('secrets:status', () =>
    Promise.resolve({ persistent: services.secrets.isPersistent() }),
  )

  register('secrets:set', async ({ connectionId, value }) => {
    await services.secrets.set({ kind: 'db-password', ownerId: connectionId }, value)
    return null
  })

  register('secrets:has', async ({ connectionId }) => {
    const stored = await services.secrets.get({ kind: 'db-password', ownerId: connectionId })
    return { exists: stored !== null }
  })

  register('operation:run', (input) => {
    const actor = buildUserActor(input.proposalId)

    // executor에 넘기는 connectionId는 renderer가 보낸 값이다. 하지만
    // WriteProposalStore.consume은 executor 안에서 이 connectionId로 제안서의
    // 커넥션과 대조한다 — 제안서는 발급 시점의 커넥션에 묶여 있으므로, renderer가
    // B의 토큰을 A라고 우겨도 소비 단계에서 막힌다. 검사가 의미를 가지려면
    // connectionId가 실제 실행 커넥션이어야 하는데, executor가 그 값으로
    // acquire하고 그 값으로 consume하므로 둘은 항상 일치한다.
    const request: OperationRequest = {
      requestId: input.requestId,
      connectionId: input.connectionId,
      operation: normalizeOperation(input.operation),
      ...(input.page === undefined ? {} : { page: input.page }),
      ...(input.limits === undefined ? {} : { limits: normalizeLimits(input.limits) }),
    }

    return services.executor.run(request, actor)
  })

  register('operation:cancel', ({ requestId }) => {
    services.executor.cancel(requestId)
    return Promise.resolve(null)
  })

  register('audit:recent', ({ limit }) => Promise.resolve(services.log.recent(limit)))

  register('dialog:openFile', () => services.fileDialog.openFile())
}

/**
 * DTO의 operation을 도메인 `Operation`으로 정규화한다.
 *
 * DTO 스키마는 `params`를 `unknown[] | undefined`로 추론하지만, 도메인 타입은
 * `exactOptionalPropertyTypes` 아래에서 "있으면 undefined가 아님"을 요구한다.
 * undefined인 `params`는 키째 빼서 둘을 맞춘다.
 */
function normalizeOperation(operation: ContractInput<'operation:run'>['operation']): Operation {
  if (operation.kind === 'sql') {
    return operation.params === undefined
      ? { kind: 'sql', sql: operation.sql }
      : { kind: 'sql', sql: operation.sql, params: operation.params }
  }
  if (operation.kind === 'data') {
    if (operation.op === 'apply') {
      return { kind: 'data', op: 'apply', schema: operation.schema, table: operation.table, changes: operation.changes }
    }
    return operation.sort === undefined
      ? { kind: 'data', op: 'browse', schema: operation.schema, table: operation.table }
      : { kind: 'data', op: 'browse', schema: operation.schema, table: operation.table, sort: operation.sort }
  }
  return operation
}

/**
 * DTO의 부분 limits에서 undefined 값을 키째 빼 도메인 `Partial<ExecutionLimits>`와
 * 맞춘다(operation과 같은 exactOptional 이유). 값 검증은 `resolveLimits`가 한다.
 */
function normalizeLimits(
  limits: NonNullable<ContractInput<'operation:run'>['limits']>,
): Partial<ExecutionLimits> {
  return {
    ...(limits.timeoutMs === undefined ? {} : { timeoutMs: limits.timeoutMs }),
    ...(limits.maxRows === undefined ? {} : { maxRows: limits.maxRows }),
    ...(limits.maxBytes === undefined ? {} : { maxBytes: limits.maxBytes }),
  }
}

/**
 * 사용자 actor를 main에서 만든다. renderer가 actor를 지정할 수 없다는 성질은
 * 여기서 actor가 오직 이 함수로만 만들어지는 것으로 보장된다.
 */
function buildUserActor(proposalId: string | undefined): Actor {
  if (proposalId === undefined) return { type: 'user', grant: null }
  return { type: 'user', grant: { proposalId } }
}
