import type { AppServices } from './compositionRoot'
import { aiConnectionIdOf } from '../core/connection/aiConnectionId'
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
    // 연결이 사라지면 그 비밀도 지운다 — 고아 비밀 방지. AI 계정 비밀도 함께.
    await services.secrets.delete({ kind: 'db-password', ownerId: id })
    await services.secrets.delete({ kind: 'db-password-ai-readonly', ownerId: id })
    return null
  })

  register('connection:open', async ({ connectionId }) => {
    const config = await services.repository.get(connectionId)
    if (config === null) return { opened: false as const, reason: `unknown connection: ${connectionId}` }
    try {
      await services.connections.open(config)
    } catch (error) {
      return { opened: false as const, reason: error instanceof Error ? error.message : String(error) }
    }
    // AI 읽기 전용 계정이 설정돼 있으면 파생 커넥션도 연다. 실패해도 사용자
    // 연결은 성공이다 — AI는 사용자 커넥션 + 읽기 전용 트랜잭션으로 내려간다
    // (executor.poolIdFor). 결과에 aiAccount를 실어 UI가 폴백 상태를 표시하고,
    // 로그에도 남겨 조용히 사라지지 않게 한다.
    let aiAccount: 'none' | 'ready' | 'failed' = 'none'
    if (typeof config.aiReadOnlyUsername === 'string' && config.aiReadOnlyUsername !== '') {
      const aiConfig = {
        ...config,
        id: aiConnectionIdOf(config.id),
        username: config.aiReadOnlyUsername,
      }
      try {
        await services.connections.open(aiConfig)
        aiAccount = 'ready'
      } catch (error) {
        aiAccount = 'failed'
        services.logger.warn('connection.ai_readonly_open_failed', {
          connectionId: config.id,
          message: error instanceof Error ? error.message : String(error),
        })
      }
    }
    return {
      opened: true as const,
      capabilities: services.connections.capabilities(config.id),
      aiAccount,
    }
  })

  register('connection:close', async ({ connectionId }) => {
    // 커넥션을 닫기 전에 그 커넥션의 라이브 구독을 정리한다(브로커 연결 해제).
    await services.streamHub.closeConnection(connectionId)
    await services.connections.close(connectionId)
    // AI 파생 커넥션도 함께 닫는다. 없으면 close는 무시한다(중복 호출 안전).
    await services.connections.close(aiConnectionIdOf(connectionId))
    return null
  })

  register('connection:status', ({ connectionId }) =>
    Promise.resolve({ status: services.connections.status(connectionId) }),
  )

  register('secrets:status', () =>
    Promise.resolve({ persistent: services.secrets.isPersistent() }),
  )

  register('secrets:set', async ({ connectionId, value, forAi }) => {
    const kind = forAi === true ? 'db-password-ai-readonly' : 'db-password'
    await services.secrets.set({ kind, ownerId: connectionId }, value)
    return null
  })

  register('secrets:has', async ({ connectionId, forAi }) => {
    const kind = forAi === true ? 'db-password-ai-readonly' : 'db-password'
    const stored = await services.secrets.get({ kind, ownerId: connectionId })
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

  register('ai:newSession', async ({ provider }) => {
    // renderer에는 chatId로 노출한다 — sessionId는 main 전용 개념(AI actor 식별).
    const { sessionId } = await services.ai.createSession(provider)
    return { chatId: sessionId }
  })

  // 스트리밍은 ai:event push로 나간다 — 이 핸들러는 수락 여부만 즉시 돌려준다.
  register('ai:send', ({ chatId, text }) => Promise.resolve(services.ai.send(chatId, text)))

  register('ai:cancel', ({ chatId }) => {
    services.ai.cancel(chatId)
    return Promise.resolve(null)
  })

  register('ai:keyStatus', async () => {
    const [anthropic, openai] = await Promise.all([
      services.secrets.get({ kind: 'llm-api-key', ownerId: 'anthropic' }),
      services.secrets.get({ kind: 'llm-api-key', ownerId: 'openai' }),
    ])
    // 존재 여부만 — 키 값은 renderer로 절대 보내지 않는다.
    return { anthropic: anthropic !== null, openai: openai !== null }
  })

  register('ai:setKey', async ({ provider, value }) => {
    await services.secrets.set({ kind: 'llm-api-key', ownerId: provider }, value)
    return null
  })

  register('ai:deleteKey', async ({ provider }) => {
    await services.secrets.delete({ kind: 'llm-api-key', ownerId: provider })
    return null
  })

  // 승인 UI용. 승인 자체는 operation:run + proposalId(위) 경로 하나뿐이다.
  register('ai:proposals', ({ connectionId }) =>
    Promise.resolve(services.proposals.listPending(connectionId)),
  )

  register('ai:rejectProposal', ({ proposalId, connectionId }) =>
    Promise.resolve({ rejected: services.proposals.reject(proposalId, connectionId) }),
  )
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
  if (operation.kind === 'document') {
    if (operation.op === 'find') {
      return {
        kind: 'document',
        op: 'find',
        collection: operation.collection,
        ...(operation.filter === undefined ? {} : { filter: operation.filter }),
        ...(operation.sort === undefined ? {} : { sort: operation.sort }),
        ...(operation.limit === undefined ? {} : { limit: operation.limit }),
      }
    }
    if (operation.op === 'aggregate') {
      return { kind: 'document', op: 'aggregate', collection: operation.collection, pipeline: operation.pipeline }
    }
    return { kind: 'document', op: 'listCollections' }
  }
  if (operation.kind === 'keyvalue') {
    if (operation.op === 'scan') {
      return operation.match === undefined
        ? { kind: 'keyvalue', op: 'scan' }
        : { kind: 'keyvalue', op: 'scan', match: operation.match }
    }
    return { kind: 'keyvalue', op: 'get', key: operation.key }
  }
  if (operation.kind === 'stream') {
    if (operation.op === 'subscribe') {
      return { kind: 'stream', op: 'subscribe', topic: operation.topic, from: operation.from }
    }
    if (operation.op === 'unsubscribe') {
      return { kind: 'stream', op: 'unsubscribe', subscriptionId: operation.subscriptionId }
    }
    return { kind: 'stream', op: 'listTopics' }
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
