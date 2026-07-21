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
      return this.failed(req, actor, req.operation, 'duplicate_request')
    }

    // **await 하기 전에** 등록한다. acquire를 기다리는 동안 등록이 비어 있으면
    // 같은 requestId의 두 번째 호출이 검사를 통과해 버리고, 그러면 cancel이
    // 어느 실행을 겨누는지 모호해진다 — 실제로 두 실행이 드라이버에 닿고
    // cancel은 나중 것만 취소했다.
    const controller = new AbortController()
    this.inFlight.set(req.requestId, controller)

    try {
      let lease: LeasedConnection
      try {
        lease = await this.connections.acquire(req.connectionId)
      } catch (error) {
        return this.failed(req, actor, req.operation, 'error', summarize(error))
      }

      try {
        return await this.runWithLease(req, actor, lease, controller)
      } finally {
        // 어떤 경로로 빠져나가든 슬롯을 돌려준다. 반납하지 않으면 커넥션의
        // 동시 실행 슬롯이 영구히 잠긴다.
        lease.release()
      }
    } finally {
      this.inFlight.delete(req.requestId)
    }
  }

  private async runWithLease(
    req: OperationRequest,
    actor: Actor,
    lease: LeasedConnection,
    controller: AbortController,
  ): Promise<OperationResult> {
    const driver = lease.driver

    // 제안서를 소비하기 **전에** 이 드라이버가 그 종류를 실행할 수 있는지부터
    // 본다. 순서를 뒤집으면, 실행에 닿지도 못한 요청이 승인 토큰을 태워 없애고
    // 사용자는 아무 일도 일어나지 않은 파괴적 쓰기를 다시 승인해야 한다.
    // 승인 토큰이 붙어 있으면 실행될 것은 언제나 sql이다.
    const kind: Operation['kind'] =
      actor.type === 'user' && actor.grant !== null ? 'sql' : req.operation.kind

    const executor = this.executors.get(kind)
    if (executor === undefined || !this.supports(driver, kind)) {
      return this.deny(req, actor, req.operation, 'capability_missing')
    }

    // 승인된 쓰기는 renderer가 보낸 문장이 아니라 main이 보관한 원문으로
    // 실행한다. connectionId는 방금 lease를 얻은 그 커넥션이다 — renderer가
    // 보낸 값이 아니라 실제로 실행될 커넥션이어야 검사가 의미를 갖는다.
    const resolved = this.resolveOperation(req, actor)
    if (resolved === null) {
      return this.failed(req, actor, req.operation, 'proposal_invalid')
    }

    const { operation, statementHash } = resolved

    const decision = decide({
      actor,
      operation,
      hasSql: driver.sql !== undefined,
      hasSchema: driver.schema !== undefined,
      hasData: driver.data !== undefined,
      supportsReadOnlyScope: driver.sql?.beginReadOnly !== undefined,
      driverClassify: (sql) => driver.sql?.classify(sql) ?? 'unknown',
      requestedLimits: req.limits,
    })

    if (!decision.allow) {
      return this.deny(req, actor, operation, decision.reason, statementHash)
    }

    return this.execute(req, actor, operation, executor, decision, lease, controller, statementHash)
  }

  private async execute(
    req: OperationRequest,
    actor: Actor,
    operation: Operation,
    executor: CapabilityExecutor,
    decision: { readonly limits: ExecutionLimits; readonly readOnlyScope: boolean },
    lease: LeasedConnection,
    controller: AbortController,
    statementHash: string | undefined,
  ): Promise<OperationResult> {
    let timedOut = false
    let timer: unknown
    let startedAt = 0
    const onLeaseAbort = (): void => {
      controller.abort()
    }

    // set/setTimeout/now를 try 밖에 두면 이들 중 하나가 던졌을 때 inFlight에
    // 항목이 남고, 그 requestId는 이후 영원히 duplicate_request가 된다.
    // run()이 결과 대신 reject하는 것도 계약 위반이다.
    // 실패 경로에서 durationMs가 epoch 크기의 숫자로 남지 않도록 먼저 잡는다.
    startedAt = this.clock.now()

    try {
      timer = this.clock.setTimeout(() => {
        timedOut = true
        controller.abort()
      }, decision.limits.timeoutMs)

      // 커넥션이 닫히면 이 실행도 끝나야 한다. 임차의 signal을 잇지 않으면
      // 사용자가 커넥션을 닫았는데 질의가 계속 도는 상태가 된다.
      if (lease.signal.aborted) controller.abort()
      else lease.signal.addEventListener('abort', onLeaseAbort, { once: true })
      const payload = await executor.execute({
        ctx: { requestId: req.requestId, signal: controller.signal },
        driver: lease.driver,
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
      // 임차는 실행마다 새로 만들어져 곧 버려지므로 이 해제가 없어도 관측
      // 가능한 누수는 생기지 않는다(그래서 변이 테스트로 잡히지 않는다).
      // 그럼에도 지우는 이유는 임차를 재사용하는 호출자가 생기는 순간
      // 조용히 리스너가 쌓이기 때문이다.
      lease.signal.removeEventListener('abort', onLeaseAbort)
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

  /**
   * 이 드라이버가 그 종류의 연산을 할 수 있는가.
   *
   * `decide()`도 `hasSql`/`hasSchema`로 같은 것을 본다 — **일부러 중복이다.**
   * 이 검사는 제안서를 소비하기 전에 걸려야 하고(승인 토큰을 헛되이 태우지
   * 않기 위해), 정책 검사는 그 뒤 모든 경로에 걸려야 한다. 한쪽만 깨뜨리는
   * 변이는 다른 쪽이 잡으므로 개별 변이는 살아남는다. 둘 다 깨뜨리면 실패한다 —
   * 방어 심층화이지 검증 구멍이 아니다.
   */
  private supports(driver: Driver, kind: Operation['kind']): boolean {
    switch (kind) {
      case 'sql':
        return driver.sql !== undefined
      case 'schema':
        return driver.schema !== undefined
      case 'data':
        return driver.data !== undefined
    }
  }

  private pageFor(req: OperationRequest, limits: ExecutionLimits): PageRequest {
    return {
      cursor: req.page?.cursor ?? DEFAULT_PAGE.cursor,
      // 정책이 정한 상한을 넘겨 요청해도 상한으로 눌러 담고, 0이나 음수도
      // 상한으로 되돌린다. page는 renderer가 보내는 값이고, maxRows: 0이면
      // 한 행도 못 돌려주면서 커서도 전진하지 않아 호출자가 무한 루프에 빠진다
      // (`resolveLimits`가 limits에 대해 같은 이유로 하는 일이다).
      maxRows: tighten(limits.maxRows, req.page?.maxRows),
      maxBytes: tighten(limits.maxBytes, req.page?.maxBytes),
    }
  }

  /**
   * 진행 중인 실행을 취소한다. 모르는 id는 조용히 무시한다.
   *
   * **이 계층의 취소는 권고다.** 여기서 하는 일은 `ctx.signal`을 발화시키는
   * 것뿐이고, 백엔드 쿼리를 실제로 멈추는 것은 드라이버 몫이다. signal을
   * 무시하는 드라이버는 취소 후에도 성공 결과를 돌려주고, 감사 로그에는
   * `allowed`가 남는다 — 사용자는 취소를 눌렀는데 데이터를 받는다.
   *
   * 실제 드라이버는 다음을 지켜야 이 보장이 진짜가 된다:
   * 1. signal 발화 시 엔진 네이티브 취소를 건다(PG `pg_cancel_backend`,
   *    MySQL `KILL QUERY`).
   * 2. `limits.timeoutMs`를 엔진 쪽 timeout으로도 건다(PG
   *    `SET LOCAL statement_timeout`). 앱 타이머만으로는 프로세스가 멈춘 동안
   *    쿼리가 계속 돈다.
   * 3. 백엔드가 조용해지기 전에 resolve/reject하지 않는다. 먼저 반환하면
   *    `release()`가 쿼리가 아직 도는 커넥션을 풀에 돌려준다.
   */
  cancel(requestId: string): void {
    this.inFlight.get(requestId)?.abort()
  }

  /**
   * 정책이 내린 거부. `denialReason`이 반드시 붙는다.
   *
   * 정책과 무관한 실패를 여기로 보내면 감사 로그에 "이유 없는 거부"가 남는다 —
   * 무슨 일이 있었는지 설명하는 것이 존재 이유인 층에서 특히 나쁘다.
   * 그런 경우는 `failed()`를 쓴다.
   */
  private deny(
    req: OperationRequest,
    actor: Actor,
    operation: Operation,
    reason: DenialReason,
    statementHash?: string,
  ): OperationResult {
    this.record(req, actor, operation, 'denied', { statementHash, denialReason: reason })

    return { ok: false, reason }
  }

  /** 정책 판정에 닿기 전에 끝난 실패(커넥션 획득 실패, 잘못된 승인 토큰 등). */
  private failed(
    req: OperationRequest,
    actor: Actor,
    operation: Operation,
    reason: FailureReason,
    errorMessage?: string,
  ): OperationResult {
    this.record(req, actor, operation, 'failed', { errorMessage: errorMessage ?? reason })

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

function tighten(cap: number, requested: number | undefined): number {
  if (requested === undefined || !Number.isFinite(requested) || requested <= 0) return cap
  return Math.min(cap, requested)
}

/** 감사 로그에 남길 문장. sql은 원문 그대로, 그 외는 무엇을 했는지 적는다. */
function describeOperation(operation: Operation): string {
  if (operation.kind === 'sql') return operation.sql
  if (operation.kind === 'data') return `data:${operation.op} ${operation.schema}.${operation.table}`

  switch (operation.op) {
    case 'listSchemas':
      return 'schema:listSchemas'
    case 'listTables':
      return `schema:listTables ${operation.schema}`
    case 'describeTable':
      return `schema:describeTable ${operation.schema}.${operation.table}`
    case 'listIndexes':
      return `schema:listIndexes ${operation.schema}.${operation.table}`
    case 'listForeignKeys':
      return `schema:listForeignKeys ${operation.schema}.${operation.table}`
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
