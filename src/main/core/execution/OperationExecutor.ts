import type {
  ExecutionLimits,
  Operation,
  OperationRequest,
} from '../../../shared/types/operation'
import type { PageRequest } from '../../../shared/types/resultSet'
import type { ConnectionManager, LeasedConnection } from '../connection/ConnectionManager'
import type { Driver } from '../driver/Driver'
import type { Actor } from './Actor'
import type { CapabilityExecutor, OperationPayload } from './CapabilityExecutor'
import { decide, type DenialReason } from './ExecutionPolicy'
import type { OperationLog, OperationOutcome } from './OperationLog'
import type { WriteProposalStore } from './WriteProposalStore'

export type FailureReason =
  | DenialReason
  | 'proposal_invalid'
  | 'duplicate_request'
  | 'cancelled'
  | 'timeout'
  | 'error'

export type OperationResult =
  | { readonly ok: true; readonly payload: OperationPayload }
  | { readonly ok: false; readonly reason: FailureReason }

export interface ExecutorClock {
  readonly now: () => number
  /** `setTimeout`을 주입해 timeout을 결정적으로 테스트한다. */
  readonly setTimeout: (fn: () => void, ms: number) => unknown
  readonly clearTimeout: (handle: unknown) => void
}

const DEFAULT_PAGE: Omit<PageRequest, 'maxRows' | 'maxBytes'> = { cursor: null }

/**
 * 모든 데이터 접근이 지나는 단일 관문.
 *
 * 여기서 하는 일: actor 판정, 쓰기 승인 소비, 실행 제한 적용, 취소·timeout,
 * lease 수명 관리, 감사 로깅. 엔진 문법 해석은 capability 실행기가 맡는다.
 *
 * 관문이 하나여야 하는 이유는 단순하다 — 경로마다 판정이 흩어지면 한 곳만
 * 빠뜨려도 AI가 승인 없이 쓰게 된다.
 */
export class OperationExecutor {
  private readonly inFlight = new Map<string, AbortController>()
  private readonly executors: ReadonlyMap<Operation['kind'], CapabilityExecutor>

  constructor(
    private readonly connections: ConnectionManager,
    private readonly log: OperationLog,
    executors: readonly CapabilityExecutor[],
    private readonly clock: ExecutorClock,
    private readonly proposals: WriteProposalStore,
  ) {
    this.executors = new Map(executors.map((executor) => [executor.kind, executor]))
  }

  async run(req: OperationRequest, actor: Actor): Promise<OperationResult> {
    // 같은 requestId가 이미 돌고 있으면 거부한다. 허용하면 cancel(requestId)이
    // 어느 실행을 겨누는지 모호해지고, 사용자가 취소를 눌렀는데 다른 실행이
    // 계속 도는 상황이 생긴다.
    if (this.inFlight.has(req.requestId)) {
      return this.fail(req, actor, req.operation, 'duplicate_request')
    }

    let lease: LeasedConnection
    try {
      lease = await this.connections.acquire(req.connectionId)
    } catch {
      return this.fail(req, actor, req.operation, 'error')
    }

    try {
      return await this.runWithLease(req, actor, lease.driver)
    } finally {
      // 어떤 경로로 빠져나가든 슬롯을 돌려준다. 반납하지 않으면 커넥션의
      // 동시 실행 슬롯이 영구히 잠긴다.
      lease.release()
    }
  }

  private async runWithLease(
    req: OperationRequest,
    actor: Actor,
    driver: Driver,
  ): Promise<OperationResult> {
    // 승인된 쓰기는 renderer가 보낸 문장이 아니라 main이 보관한 원문으로
    // 실행한다. connectionId는 방금 lease를 얻은 그 커넥션이다 — renderer가
    // 보낸 값이 아니라 실제로 실행될 커넥션이어야 검사가 의미를 갖는다.
    const resolved = this.resolveOperation(req, actor)
    if (resolved === null) {
      return this.fail(req, actor, req.operation, 'proposal_invalid')
    }

    const { operation, statementHash } = resolved

    const decision = decide({
      actor,
      operation,
      hasSql: driver.sql !== undefined,
      hasSchema: driver.schema !== undefined,
      supportsReadOnlyScope: driver.sql?.beginReadOnly !== undefined,
      driverClassify: (sql) => driver.sql?.classify(sql) ?? 'unknown',
      requestedLimits: req.limits,
    })

    if (!decision.allow) {
      return this.fail(req, actor, operation, decision.reason, statementHash)
    }

    const executor = this.executors.get(operation.kind)
    if (executor === undefined) {
      return this.fail(req, actor, operation, 'capability_missing', statementHash)
    }

    return this.execute(req, actor, operation, executor, decision, driver, statementHash)
  }

  private async execute(
    req: OperationRequest,
    actor: Actor,
    operation: Operation,
    executor: CapabilityExecutor,
    decision: { readonly limits: ExecutionLimits; readonly readOnlyScope: boolean },
    driver: Driver,
    statementHash: string | undefined,
  ): Promise<OperationResult> {
    const controller = new AbortController()
    this.inFlight.set(req.requestId, controller)

    let timedOut = false
    const timer = this.clock.setTimeout(() => {
      timedOut = true
      controller.abort()
    }, decision.limits.timeoutMs)

    const startedAt = this.clock.now()

    try {
      const payload = await executor.execute({
        ctx: { requestId: req.requestId, signal: controller.signal },
        driver,
        operation,
        page: this.pageFor(req, decision.limits),
        limits: decision.limits,
        readOnlyScope: decision.readOnlyScope,
      })

      this.record(req, actor, operation, 'allowed', {
        statementHash,
        durationMs: this.clock.now() - startedAt,
      })

      return { ok: true, payload }
    } catch (error) {
      const reason: FailureReason = timedOut
        ? 'timeout'
        : controller.signal.aborted
          ? 'cancelled'
          : 'error'

      // 드라이버 원문 메시지는 main 로그에만 남긴다. 결과에 실어 보내면
      // 엔진이 오류에 담아 보내는 행 값·스키마 정보가 renderer로 샌다.
      this.record(req, actor, operation, 'failed', {
        statementHash,
        durationMs: this.clock.now() - startedAt,
        errorMessage: summarize(error),
      })

      return { ok: false, reason }
    } finally {
      // 타이머를 지우지 않으면 실행이 끝난 뒤에도 핸들이 살아 있다.
      this.clock.clearTimeout(timer)
      this.inFlight.delete(req.requestId)
    }
  }

  /**
   * 승인 토큰이 붙어 있으면 제안서를 소비해 **보관된 원문**으로 바꾼다.
   * 토큰이 없으면 요청을 그대로 쓴다.
   *
   * 실패하면 null. renderer가 보낸 SQL은 어떤 경우에도 승인된 것으로 취급하지
   * 않는다 — 그 뒤집힘이 이 프로토콜의 존재 이유다.
   */
  private resolveOperation(
    req: OperationRequest,
    actor: Actor,
  ): { operation: Operation; statementHash: string | undefined } | null {
    if (actor.type !== 'user' || actor.grant === null) {
      return { operation: req.operation, statementHash: undefined }
    }

    const consumed = this.proposals.consume(actor.grant.proposalId, req.connectionId)
    if (!consumed.ok) return null

    return {
      operation: { kind: 'sql', sql: consumed.statement },
      statementHash: consumed.statementHash,
    }
  }

  private pageFor(req: OperationRequest, limits: ExecutionLimits): PageRequest {
    return {
      cursor: req.page?.cursor ?? DEFAULT_PAGE.cursor,
      // 정책이 정한 상한을 넘겨 요청해도 상한으로 눌러 담는다.
      maxRows: Math.min(limits.maxRows, req.page?.maxRows ?? limits.maxRows),
      maxBytes: Math.min(limits.maxBytes, req.page?.maxBytes ?? limits.maxBytes),
    }
  }

  /** 진행 중인 실행을 취소한다. 모르는 id는 조용히 무시한다. */
  cancel(requestId: string): void {
    this.inFlight.get(requestId)?.abort()
  }

  private fail(
    req: OperationRequest,
    actor: Actor,
    operation: Operation,
    reason: FailureReason,
    statementHash?: string,
  ): OperationResult {
    // 거부도 기록한다. 성공만 남기면 AI가 무엇을 시도했는지 알 수 없다.
    this.record(req, actor, operation, 'denied', {
      statementHash,
      denialReason: isDenialReason(reason) ? reason : undefined,
    })

    return { ok: false, reason }
  }

  private record(
    req: OperationRequest,
    actor: Actor,
    operation: Operation,
    outcome: OperationOutcome,
    extra: {
      statementHash?: string | undefined
      denialReason?: DenialReason | undefined
      durationMs?: number | undefined
      errorMessage?: string | undefined
    },
  ): void {
    const proposalId = actor.type === 'user' ? actor.grant?.proposalId : undefined

    // exactOptionalPropertyTypes가 켜져 있어 `undefined`를 그대로 넘길 수 없다.
    // 값이 없으면 키 자체를 빼는 것이 이 코드베이스의 기존 방식이다
    // (buildResultSet의 notices 처리와 같다).
    this.log.record({
      requestId: req.requestId,
      connectionId: req.connectionId,
      actorType: actor.type,
      actorId: actor.type === 'ai' ? actor.sessionId : null,
      statement: describeOperation(operation),
      outcome,
      ...(proposalId === undefined ? {} : { proposalId }),
      ...(extra.statementHash === undefined ? {} : { statementHash: extra.statementHash }),
      ...(extra.denialReason === undefined ? {} : { denialReason: extra.denialReason }),
      ...(extra.durationMs === undefined ? {} : { durationMs: extra.durationMs }),
      ...(extra.errorMessage === undefined ? {} : { errorMessage: extra.errorMessage }),
    })
  }
}

const DENIAL_REASONS: readonly FailureReason[] = [
  'ai_write_requires_proposal',
  'ai_multi_statement',
  'ai_read_only_unsupported',
  'capability_missing',
]

function isDenialReason(reason: FailureReason): reason is DenialReason {
  return DENIAL_REASONS.includes(reason)
}

/** 감사 로그에 남길 문장. sql은 원문 그대로, 그 외는 무엇을 했는지 적는다. */
function describeOperation(operation: Operation): string {
  if (operation.kind === 'sql') return operation.sql

  switch (operation.op) {
    case 'listSchemas':
      return 'schema:listSchemas'
    case 'listTables':
      return `schema:listTables ${operation.schema}`
    case 'describeTable':
      return `schema:describeTable ${operation.schema}.${operation.table}`
  }
}

/**
 * 드라이버 오류를 감사 로그에 남길 형태로 줄인다.
 *
 * 원문을 그대로 남기지 않는 이유: 엔진에 따라 제약 위반 메시지에 위반한 행의
 * 값이 실려 온다. 감사 로그는 사용자가 열어보는 것이고, 자격증명을 남기지
 * 않는 것과 같은 이유로 데이터도 남기면 안 된다.
 */
function summarize(error: unknown): string {
  if (!(error instanceof Error)) return 'unknown error'
  return error.name
}
