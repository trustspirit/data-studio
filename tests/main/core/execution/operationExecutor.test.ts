import { describe, expect, it } from 'vitest'
import { OperationExecutor } from '@main/core/execution/OperationExecutor'
import { WriteProposalStore } from '@main/core/execution/WriteProposalStore'
import { InMemoryOperationLog } from '@main/infrastructure/execution/InMemoryOperationLog'
import { SqlCapabilityExecutor } from '@main/infrastructure/execution/SqlCapabilityExecutor'
import { SchemaCapabilityExecutor } from '@main/infrastructure/execution/SchemaCapabilityExecutor'
import { DEFAULT_AI_LIMITS, DEFAULT_USER_LIMITS } from '@shared/types/operation'
import type { Operation, OperationRequest } from '@shared/types/operation'
import type { Actor } from '@main/core/execution/Actor'
import type { Driver } from '@main/core/driver/Driver'
import type { ConnectionManager, LeasedConnection } from '@main/core/connection/ConnectionManager'
import type { ExecutionLimits } from '@shared/types/operation'
import type { PageRequest, ResultSet } from '@shared/types/resultSet'
import type { ExecutionContext } from '@main/core/driver/ExecutionContext'
import type { ReadOnlyScope } from '@main/core/driver/capabilities/SqlCapability'
import type { SchemaInfo, TableDetail, TableInfo } from '@main/core/driver/capabilities/SchemaCapability'

const USER: Actor = { type: 'user', grant: null }
const AI: Actor = { type: 'ai', sessionId: 'sess-1' }

const READ: Operation = { kind: 'sql', sql: 'SELECT 1' }

function emptyResult(requestId: string): ResultSet {
  return {
    requestId,
    columns: [],
    rows: [],
    page: { cursor: null, hasMore: false, rowCount: 0, bytes: 0 },
    meta: { durationMs: 0, truncatedRows: false, truncatedBytes: false, rowsAffected: null },
  }
}

interface RecordedExecute {
  sql: string
  page: PageRequest
  params?: readonly unknown[] | undefined
  requestId: string
}

interface Calls {
  execute: RecordedExecute[]
  scopedExecute: RecordedExecute[]
  limits?: ExecutionLimits | undefined
  beginReadOnly: number
  scopeEnd: number
  listSchemas: number
  listTables: string[]
  listIndexes: Array<{ schema: string; table: string }>
  listForeignKeys: Array<{ schema: string; table: string }>
  release: number
}

interface FakeOptions {
  readonly withSql?: boolean
  readonly withSchema?: boolean
  readonly withReadOnlyScope?: boolean
  readonly classify?: 'read' | 'write' | 'unknown'
  /** execute가 이 promise를 기다린 뒤에야 끝난다. 취소·timeout 테스트용. */
  readonly gate?: Promise<void>
  readonly failWith?: Error
  readonly acquireFails?: boolean
}

function createHarness(options: FakeOptions = {}) {
  const {
    withSql = true,
    withSchema = true,
    withReadOnlyScope = true,
    classify = 'read',
  } = options

  const calls: Calls = {
    execute: [],
    scopedExecute: [],
    beginReadOnly: 0,
    scopeEnd: 0,
    listSchemas: 0,
    listTables: [],
    listIndexes: [],
    listForeignKeys: [],
    release: 0,
  }

  async function runBody(ctx: ExecutionContext): Promise<void> {
    if (options.gate !== undefined) {
      await Promise.race([
        options.gate,
        new Promise<never>((_, reject) => {
          ctx.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
        }),
      ])
    }
    if (options.failWith !== undefined) throw options.failWith
  }

  const scope: ReadOnlyScope = {
    async execute(ctx, sql, page, params) {
      calls.scopedExecute.push({ sql, page, params, requestId: ctx.requestId })
      await runBody(ctx)
      return emptyResult(ctx.requestId)
    },
    end() {
      calls.scopeEnd += 1
      return Promise.resolve()
    },
  }

  const driver: Driver = {
    id: 'conn-1',
    engine: 'postgres',
    connect: () => Promise.resolve(),
    disconnect: () => Promise.resolve(),
    ping: () => Promise.resolve(1),
    ...(withSql
      ? {
          sql: {
            async execute(ctx, sql, page, params) {
              calls.execute.push({ sql, page, params, requestId: ctx.requestId })
              await runBody(ctx)
              return emptyResult(ctx.requestId)
            },
            classify: () => classify,
            ...(withReadOnlyScope
              ? {
                  beginReadOnly: () => {
                    calls.beginReadOnly += 1
                    return Promise.resolve(scope)
                  },
                }
              : {}),
          },
        }
      : {}),
    ...(withSchema
      ? {
          schema: {
            listSchemas: (): Promise<readonly SchemaInfo[]> => {
              calls.listSchemas += 1
              return Promise.resolve([{ name: 'public' }])
            },
            listTables: (_ctx, schemaName: string): Promise<readonly TableInfo[]> => {
              calls.listTables.push(schemaName)
              return Promise.resolve([])
            },
            describeTable: (): Promise<TableDetail> =>
              Promise.reject(new Error('not used in this test')),
            listIndexes: (_ctx, schemaName: string, table: string) => {
              calls.listIndexes.push({ schema: schemaName, table })
              return Promise.resolve([
                { name: `${table}_pkey`, columns: ['id'], unique: true, sizeBytes: null },
              ])
            },
            listForeignKeys: (_ctx, schemaName: string, table: string) => {
              calls.listForeignKeys.push({ schema: schemaName, table })
              return Promise.resolve([
                {
                  name: `${table}_fk`,
                  columns: ['ref_id'],
                  referencedSchema: 'public',
                  referencedTable: 'other',
                  referencedColumns: ['id'],
                },
              ])
            },
          },
        }
      : {}),
  }

  const leaseController = new AbortController()
  const lease: LeasedConnection = {
    driver,
    signal: leaseController.signal,
    release: () => {
      calls.release += 1
    },
  }

  const connections = {
    acquire: (): Promise<LeasedConnection> =>
      options.acquireFails === true
        ? Promise.reject(new Error('not open'))
        : Promise.resolve(lease),
    open: () => Promise.resolve(),
    close: () => Promise.resolve(),
    closeAll: () => Promise.resolve(),
    status: () => 'ready' as const,
    checkHealth: () => Promise.resolve(true),
  } satisfies ConnectionManager

  let now = 1_000
  const timers: { fn: () => void; ms: number; cleared: boolean }[] = []

  const log = new InMemoryOperationLog({ now: () => (now += 1) })
  const proposals = new WriteProposalStore({
    now: () => now,
    randomId: () => `prop-${timers.length}-${calls.execute.length}-${Math.trunc(now)}`,
    hash: (text) => `hash(${text})`,
  })

  const executor = new OperationExecutor(
    connections,
    log,
    [new SqlCapabilityExecutor(), new SchemaCapabilityExecutor()].map((inner) => ({
      kind: inner.kind,
      execute: (input) => {
        calls.limits = input.limits
        return inner.execute(input)
      },
    })),
    {
      now: () => now,
      setTimeout: (fn, ms) => {
        timers.push({ fn, ms, cleared: false })
        return timers.length - 1
      },
      clearTimeout: (handle) => {
        const timer = timers[handle as number]
        if (timer !== undefined) timer.cleared = true
      },
    },
    proposals,
  )

  return {
    executor,
    calls,
    log,
    proposals,
    driver,
    timers,
    fireTimer: (index = 0) => timers[index]?.fn(),
    /** 커넥션이 닫힌 상황을 흉내 낸다. */
    closeConnection: () => leaseController.abort(),
  }
}

function request(over: Partial<OperationRequest> = {}): OperationRequest {
  return { requestId: 'req-1', connectionId: 'conn-1', operation: READ, ...over }
}

describe('OperationExecutor — 실행', () => {
  it('사용자 읽기를 실행하고 결과를 돌려준다', async () => {
    const h = createHarness()

    const result = await h.executor.run(request(), USER)

    expect(result).toMatchObject({ ok: true, payload: { kind: 'rows' } })
    expect(h.calls.execute).toHaveLength(1)
  })

  it('정책이 거부하면 드라이버를 부르지 않는다', async () => {
    // 거부인데 실행이 일어나면 게이트가 장식이 된다.
    const h = createHarness({ classify: 'write' })

    const result = await h.executor.run(request(), AI)

    expect(result).toEqual({ ok: false, reason: 'ai_write_requires_proposal' })
    expect(h.calls.execute).toHaveLength(0)
    expect(h.calls.scopedExecute).toHaveLength(0)
  })

  it('거부를 감사 로그에 남긴다', async () => {
    const h = createHarness({ classify: 'write' })

    await h.executor.run(request(), AI)

    expect(h.log.recent(1)[0]).toMatchObject({
      outcome: 'denied',
      denialReason: 'ai_write_requires_proposal',
      actorType: 'ai',
      actorId: 'sess-1',
    })
  })

  it('AI 읽기는 beginReadOnly 스코프 안에서 실행한다', async () => {
    const h = createHarness()

    await h.executor.run(request(), AI)

    expect(h.calls.beginReadOnly).toBe(1)
    expect(h.calls.scopedExecute).toHaveLength(1)
    // 스코프 밖 경로는 쓰이지 않아야 한다.
    expect(h.calls.execute).toHaveLength(0)
  })

  it('AI 읽기가 끝나면 스코프를 end한다', async () => {
    const h = createHarness()

    await h.executor.run(request(), AI)

    expect(h.calls.scopeEnd).toBe(1)
  })

  it('AI 읽기가 실패해도 스코프를 end한다', async () => {
    // end를 빠뜨리면 읽기 전용 트랜잭션이 열린 채 남아 커넥션이 잠긴다.
    const h = createHarness({ failWith: new Error('boom'), gate: Promise.resolve() })

    const result = await h.executor.run(request(), AI)

    expect(result.ok).toBe(false)
    expect(h.calls.scopeEnd).toBe(1)
  })

  it('실행이 끝나면 lease를 반납한다', async () => {
    const h = createHarness()

    await h.executor.run(request(), USER)

    expect(h.calls.release).toBe(1)
  })

  it('실행이 실패해도 lease를 반납한다', async () => {
    const h = createHarness({ failWith: new Error('boom'), gate: Promise.resolve() })

    await h.executor.run(request(), USER)

    expect(h.calls.release).toBe(1)
  })

  it('정책이 거부해도 lease를 반납한다', async () => {
    const h = createHarness({ classify: 'write' })

    await h.executor.run(request(), AI)

    expect(h.calls.release).toBe(1)
  })
})

describe('OperationExecutor — 제한', () => {
  it('정책이 정한 제한을 page 요청에 반영한다', async () => {
    const h = createHarness()

    await h.executor.run(request(), USER)

    expect(h.calls.execute[0]?.page).toMatchObject({
      maxRows: DEFAULT_USER_LIMITS.maxRows,
      maxBytes: DEFAULT_USER_LIMITS.maxBytes,
    })
  })

  it('AI 기본값은 사용자 기본값과 timeout이 다르다', () => {
    // 이 테스트가 없으면 아래 두 테스트가 무의미해진다. maxRows/maxBytes는 두
    // 기본값이 같아서 그것만 단언하면 AI 제한과 사용자 제한을 구분하지 못한다.
    expect(DEFAULT_AI_LIMITS.timeoutMs).toBe(10_000)
    expect(DEFAULT_USER_LIMITS.timeoutMs).toBe(30_000)
  })

  it('AI 경로에는 AI timeout을 건다', async () => {
    const h = createHarness()

    await h.executor.run(request(), AI)

    expect(h.timers[0]?.ms).toBe(DEFAULT_AI_LIMITS.timeoutMs)
  })

  it('사용자 경로에는 사용자 timeout을 건다', async () => {
    const h = createHarness()

    await h.executor.run(request(), USER)

    expect(h.timers[0]?.ms).toBe(DEFAULT_USER_LIMITS.timeoutMs)
  })

  it('AI 경로에는 AI 행 상한을 건다', async () => {
    const h = createHarness()

    await h.executor.run(request(), AI)

    expect(h.calls.scopedExecute[0]?.page).toMatchObject({ maxRows: DEFAULT_AI_LIMITS.maxRows })
  })

  it('요청한 limits도 상한 이내로만 받아들인다', async () => {
    const h = createHarness()

    await h.executor.run(request({ limits: { maxRows: 7, timeoutMs: 999_999 } }), USER)

    expect(h.calls.execute[0]?.page.maxRows).toBe(7)
    expect(h.timers[0]?.ms).toBe(DEFAULT_USER_LIMITS.timeoutMs)
  })

  it('요청이 제한보다 느슨하면 제한으로 눌러 담는다', async () => {
    const h = createHarness()

    await h.executor.run(
      request({ page: { cursor: null, maxRows: 999_999, maxBytes: 999_999_999 } }),
      USER,
    )

    expect(h.calls.execute[0]?.page).toMatchObject({
      maxRows: DEFAULT_USER_LIMITS.maxRows,
      maxBytes: DEFAULT_USER_LIMITS.maxBytes,
    })
  })

  it('page의 0이나 음수는 상한으로 되돌린다', async () => {
    // maxRows: 0이면 한 행도 못 돌려주면서 커서도 전진하지 않아 호출자가
    // 무한 루프에 빠진다. page는 renderer가 보내는 값이다.
    const h = createHarness()

    await h.executor.run(request({ page: { cursor: null, maxRows: 0, maxBytes: -5 } }), USER)

    expect(h.calls.execute[0]?.page).toMatchObject({
      maxRows: DEFAULT_USER_LIMITS.maxRows,
      maxBytes: DEFAULT_USER_LIMITS.maxBytes,
    })
  })

  it('요청이 제한보다 엄격하면 요청을 받아들인다', async () => {
    const h = createHarness()

    await h.executor.run(request({ page: { cursor: 'c1', maxRows: 5, maxBytes: 1_000 } }), USER)

    expect(h.calls.execute[0]?.page).toEqual({ cursor: 'c1', maxRows: 5, maxBytes: 1_000 })
  })
})

describe('OperationExecutor — 파라미터와 컨텍스트', () => {
  it('쿼리 파라미터를 드라이버에 그대로 넘긴다', async () => {
    // 파라미터는 문자열 보간의 안전한 대안이다. 조용히 떨어지면 드라이버가
    // 플레이스홀더만 있는 문장을 받는다.
    const h = createHarness()

    await h.executor.run(
      request({ operation: { kind: 'sql', sql: 'SELECT * FROM t WHERE id = $1', params: [42] } }),
      USER,
    )

    expect(h.calls.execute[0]?.params).toEqual([42])
  })

  it('AI 경로에서도 쿼리 파라미터를 잃지 않는다', async () => {
    // 읽기 전용 스코프는 AI 경로의 유일한 실행 통로다. 여기서 파라미터가
    // 조용히 떨어지면 AI는 값을 문자열로 이어 붙이도록 떠밀린다.
    const h = createHarness()

    await h.executor.run(
      request({ operation: { kind: 'sql', sql: 'SELECT * FROM t WHERE id = $1', params: [7] } }),
      AI,
    )

    expect(h.calls.scopedExecute[0]?.params).toEqual([7])
  })

  it('requestId를 ExecutionContext로 전달한다', async () => {
    // 엔진 네이티브 취소가 이 값으로 백엔드를 찾는다.
    const h = createHarness()

    await h.executor.run(request({ requestId: 'req-xyz' }), USER)

    expect(h.calls.execute[0]?.requestId).toBe('req-xyz')
  })

  it('정책이 정한 제한을 capability 실행기에 전달한다', async () => {
    // 드라이버가 statement_timeout을 걸 때 읽는 값이다.
    const h = createHarness()

    await h.executor.run(request(), AI)

    expect(h.calls.limits?.timeoutMs).toBe(DEFAULT_AI_LIMITS.timeoutMs)
  })

  it('성공한 실행의 소요 시간을 기록한다', async () => {
    const h = createHarness()

    await h.executor.run(request(), USER)

    expect(h.log.recent(1)[0]?.durationMs).toBeGreaterThanOrEqual(0)
  })
})

describe('OperationExecutor — 취소와 timeout', () => {
  it('cancel(requestId)이 진행 중인 실행의 signal을 발화시킨다', async () => {
    const h = createHarness({ gate: new Promise<void>(() => undefined) })

    const running = h.executor.run(request(), USER)
    await Promise.resolve()
    h.executor.cancel('req-1')

    expect(await running).toEqual({ ok: false, reason: 'cancelled' })
  })

  it('timeout이 지나면 실행이 timeout으로 끝난다', async () => {
    const h = createHarness({ gate: new Promise<void>(() => undefined) })

    const running = h.executor.run(request(), USER)
    await Promise.resolve()
    h.fireTimer()

    expect(await running).toEqual({ ok: false, reason: 'timeout' })
  })

  it('timeout 타이머를 정책이 정한 값으로 건다', async () => {
    const h = createHarness()

    await h.executor.run(request(), USER)

    expect(h.timers[0]?.ms).toBe(DEFAULT_USER_LIMITS.timeoutMs)
  })

  it('실행이 끝나면 timeout 타이머를 지운다', async () => {
    const h = createHarness()

    await h.executor.run(request(), USER)

    expect(h.timers[0]?.cleared).toBe(true)
  })

  it('커넥션이 닫히면 진행 중인 실행이 취소된다', async () => {
    // 임차의 signal을 잇지 않으면, 사용자가 커넥션을 닫았는데 질의는 계속 돈다.
    const h = createHarness({ gate: new Promise<void>(() => undefined) })

    const running = h.executor.run(request(), USER)
    await Promise.resolve()
    h.closeConnection()

    expect(await running).toEqual({ ok: false, reason: 'cancelled' })
  })

  it('모르는 requestId 취소는 조용히 무시한다', () => {
    const h = createHarness()

    expect(() => h.executor.cancel('nope')).not.toThrow()
  })

  it('같은 requestId로 동시에 두 번 실행할 수 없다', async () => {
    // 허용하면 cancel(requestId)이 어느 실행을 겨누는지 모호해진다.
    const h = createHarness({ gate: new Promise<void>(() => undefined) })

    const first = h.executor.run(request(), USER)
    await Promise.resolve()
    const second = await h.executor.run(request(), USER)

    expect(second).toEqual({ ok: false, reason: 'duplicate_request' })

    h.executor.cancel('req-1')
    await first
  })

  it('acquire를 기다리는 동안에도 중복 요청을 막는다', async () => {
    // 등록이 acquire 뒤에 있으면 두 번째 호출이 검사를 통과해 둘 다 드라이버에
    // 닿고, cancel은 나중 것만 취소한다.
    const h = createHarness({ gate: new Promise<void>(() => undefined) })

    const first = h.executor.run(request(), USER)
    const second = h.executor.run(request(), USER)

    expect(await second).toEqual({ ok: false, reason: 'duplicate_request' })
    expect(h.calls.execute.length).toBeLessThanOrEqual(1)

    h.executor.cancel('req-1')
    await first
  })

  it('끝난 뒤에는 같은 requestId를 다시 쓸 수 있다', async () => {
    const h = createHarness()

    await h.executor.run(request(), USER)
    const again = await h.executor.run(request(), USER)

    expect(again.ok).toBe(true)
  })
})

describe('OperationExecutor — 실패 처리', () => {
  it('드라이버 예외를 실패 결과로 옮기고 로그에 남긴다', async () => {
    const h = createHarness({ failWith: new Error('boom'), gate: Promise.resolve() })

    const result = await h.executor.run(request(), USER)

    expect(result).toEqual({ ok: false, reason: 'error' })
    expect(h.log.recent(1)[0]).toMatchObject({ outcome: 'failed' })
  })

  it('드라이버 예외 메시지를 결과에 그대로 싣지 않는다', async () => {
    // 엔진에 따라 오류 메시지에 위반한 행 값이 실려 온다.
    const secret = new Error("duplicate key: email='alice@example.com'")
    const h = createHarness({ failWith: secret, gate: Promise.resolve() })

    const result = await h.executor.run(request(), USER)

    expect(JSON.stringify(result)).not.toContain('alice@example.com')
  })

  it('드라이버 예외 메시지를 감사 로그에도 그대로 싣지 않는다', async () => {
    // 감사 로그는 사용자가 열어보는 것이다. 자격증명을 남기지 않는 것과 같은
    // 이유로, 엔진이 제약 위반 메시지에 실어 보내는 행 값도 남기면 안 된다.
    const secret = new Error("duplicate key: email='alice@example.com'")
    const h = createHarness({ failWith: secret, gate: Promise.resolve() })

    await h.executor.run(request(), USER)

    const entry = h.log.recent(1)[0]
    expect(entry?.outcome).toBe('failed')
    expect(entry?.errorMessage).not.toContain('alice@example.com')
    expect(JSON.stringify(entry)).not.toContain('alice@example.com')
  })

  it('커넥션을 얻지 못하면 실패로 끝나고 드라이버를 부르지 않는다', async () => {
    const h = createHarness({ acquireFails: true })

    const result = await h.executor.run(request(), USER)

    expect(result).toEqual({ ok: false, reason: 'error' })
    expect(h.calls.execute).toHaveLength(0)
  })

  it('정책과 무관한 실패는 거부가 아니라 실패로 기록한다', async () => {
    // 'denied'로 남기면 denialReason 없는 거부가 되고, 감사 로그가 무슨 일이
    // 있었는지 설명하지 못한다.
    const h = createHarness({ acquireFails: true })

    await h.executor.run(request(), USER)

    const entry = h.log.recent(1)[0]
    expect(entry?.outcome).toBe('failed')
    expect(entry?.denialReason).toBeUndefined()
    expect(entry?.errorMessage).toBeDefined()
  })

  it('정책 거부에는 반드시 denialReason이 붙는다', async () => {
    const h = createHarness({ classify: 'write' })

    await h.executor.run(request(), AI)

    const entry = h.log.recent(1)[0]
    expect(entry?.outcome).toBe('denied')
    expect(entry?.denialReason).toBe('ai_write_requires_proposal')
  })
})

describe('OperationExecutor — capability 라우팅', () => {
  it('schema 요청을 schema executor로 보낸다', async () => {
    const h = createHarness()

    const result = await h.executor.run(
      request({ operation: { kind: 'schema', op: 'listSchemas' } }),
      USER,
    )

    expect(result).toMatchObject({ ok: true, payload: { kind: 'schemas' } })
    expect(h.calls.listSchemas).toBe(1)
  })

  it('schema 요청은 sql 경로에 닿지 않는다', async () => {
    // 정책은 schema 연산에 읽기 전용 스코프를 요구하지 않는다. schema 요청이
    // sql 실행으로 흘러가면 AI가 스코프 없이 임의 SQL을 돌리는 통로가 된다.
    const h = createHarness()

    await h.executor.run(request({ operation: { kind: 'schema', op: 'listSchemas' } }), AI)

    expect(h.calls.execute).toHaveLength(0)
    expect(h.calls.scopedExecute).toHaveLength(0)
    expect(h.calls.beginReadOnly).toBe(0)
  })

  it('schema 요청의 인자를 드라이버에 그대로 넘긴다', async () => {
    const h = createHarness()

    await h.executor.run(
      request({ operation: { kind: 'schema', op: 'listTables', schema: 'analytics' } }),
      USER,
    )

    expect(h.calls.listTables).toEqual(['analytics'])
  })

  it('sql 능력이 없는 드라이버에 sql 요청이 오면 거부한다', async () => {
    const h = createHarness({ withSql: false })

    const result = await h.executor.run(request(), USER)

    expect(result).toEqual({ ok: false, reason: 'capability_missing' })
  })

  it('schema 능력이 없는 드라이버에 schema 요청이 오면 거부한다', async () => {
    const h = createHarness({ withSchema: false })

    const result = await h.executor.run(
      request({ operation: { kind: 'schema', op: 'listSchemas' } }),
      USER,
    )

    // 실행 실패가 아니라 거부여야 한다. 'error'로 나가면 감사 로그에 능력 부족이
    // 실행 실패로 잘못 기록된다.
    expect(result).toEqual({ ok: false, reason: 'capability_missing' })
    expect(h.log.recent(1)[0]?.outcome).toBe('denied')
  })

  it('읽기 전용 스코프를 지원하지 않으면 AI 읽기를 거부한다', async () => {
    const h = createHarness({ withReadOnlyScope: false })

    const result = await h.executor.run(request(), AI)

    expect(result).toEqual({ ok: false, reason: 'ai_read_only_unsupported' })
    expect(h.calls.execute).toHaveLength(0)
  })

  it('listIndexes 요청을 schema executor로 보내고 indexes payload를 준다', async () => {
    const h = createHarness()

    const result = await h.executor.run(
      request({ operation: { kind: 'schema', op: 'listIndexes', schema: 'public', table: 'users' } }),
      USER,
    )

    expect(result).toMatchObject({ ok: true, payload: { kind: 'indexes' } })
    expect(h.calls.listIndexes).toEqual([{ schema: 'public', table: 'users' }])
    // sql 경로에 닿지 않아야 한다 — 메타 조회에 임의 SQL 통로가 생기면 안 된다.
    expect(h.calls.execute).toHaveLength(0)
  })

  it('listForeignKeys 요청을 schema executor로 보내고 foreignKeys payload를 준다', async () => {
    const h = createHarness()

    const result = await h.executor.run(
      request({
        operation: { kind: 'schema', op: 'listForeignKeys', schema: 'public', table: 'orders' },
      }),
      USER,
    )

    expect(result).toMatchObject({ ok: true, payload: { kind: 'foreignKeys' } })
    expect(h.calls.listForeignKeys).toEqual([{ schema: 'public', table: 'orders' }])
    expect(h.calls.execute).toHaveLength(0)
  })
})

describe('OperationExecutor — 쓰기 승인', () => {
  function proposeWrite(h: ReturnType<typeof createHarness>, connectionId = 'conn-1') {
    return h.proposals.propose({
      connectionId,
      statement: 'DELETE FROM users',
      impact: { summary: '', estimatedRows: null },
    })
  }

  it('승인 토큰이 있으면 보관된 원문을 실행한다', async () => {
    const h = createHarness({ classify: 'write' })
    const view = proposeWrite(h)

    const result = await h.executor.run(
      // renderer가 보낸 sql은 무해한 문장이다. 실행되는 것은 보관본이어야 한다.
      request({ operation: { kind: 'sql', sql: 'SELECT 1' } }),
      { type: 'user', grant: { proposalId: view.proposalId } },
    )

    expect(result.ok).toBe(true)
    expect(h.calls.execute[0]?.sql).toBe('DELETE FROM users')
  })

  it('renderer가 보낸 sql은 승인된 것으로 취급하지 않는다', async () => {
    const h = createHarness({ classify: 'write' })
    const view = proposeWrite(h)

    await h.executor.run(
      request({ operation: { kind: 'sql', sql: 'DROP TABLE audit_log' } }),
      { type: 'user', grant: { proposalId: view.proposalId } },
    )

    expect(h.calls.execute[0]?.sql).toBe('DELETE FROM users')
    expect(h.calls.execute[0]?.sql).not.toContain('audit_log')
  })

  it('같은 토큰을 두 번 쓸 수 없다', async () => {
    const h = createHarness({ classify: 'write' })
    const view = proposeWrite(h)
    const actor: Actor = { type: 'user', grant: { proposalId: view.proposalId } }

    await h.executor.run(request({ requestId: 'r1' }), actor)
    const replay = await h.executor.run(request({ requestId: 'r2' }), actor)

    expect(replay).toEqual({ ok: false, reason: 'proposal_invalid' })
    expect(h.calls.execute).toHaveLength(1)
  })

  it('다른 커넥션의 토큰은 거부한다', async () => {
    const h = createHarness({ classify: 'write' })
    const view = proposeWrite(h, 'conn-2')

    const result = await h.executor.run(request(), {
      type: 'user',
      grant: { proposalId: view.proposalId },
    })

    expect(result).toEqual({ ok: false, reason: 'proposal_invalid' })
    expect(h.calls.execute).toHaveLength(0)
  })

  it('모르는 토큰은 거부한다', async () => {
    const h = createHarness()

    const result = await h.executor.run(request(), {
      type: 'user',
      grant: { proposalId: 'nope' },
    })

    expect(result).toEqual({ ok: false, reason: 'proposal_invalid' })
    expect(h.calls.execute).toHaveLength(0)
  })

  it('실행에 닿지 못한 거부는 승인 토큰을 태우지 않는다', async () => {
    // 이 드라이버는 sql을 못 한다. 요청은 실행되지 않으므로, 사용자가 승인한
    // 토큰이 소모되어서는 안 된다 — 아무 일도 일어나지 않은 파괴적 쓰기를
    // 다시 승인하게 만드는 것은 승인 피로를 부른다.
    const h = createHarness({ withSql: false })
    const view = proposeWrite(h)

    const result = await h.executor.run(request(), {
      type: 'user',
      grant: { proposalId: view.proposalId },
    })

    expect(result).toEqual({ ok: false, reason: 'capability_missing' })
    // 제안서가 아직 살아 있어야 한다.
    expect(h.proposals.pending(view.proposalId)).not.toBeNull()
  })

  it('승인 실행을 proposalId와 함께 로그에 남긴다', async () => {
    const h = createHarness({ classify: 'write' })
    const view = proposeWrite(h)

    await h.executor.run(request(), { type: 'user', grant: { proposalId: view.proposalId } })

    expect(h.log.recent(1)[0]).toMatchObject({
      outcome: 'allowed',
      proposalId: view.proposalId,
      statement: 'DELETE FROM users',
      statementHash: 'hash(DELETE FROM users)',
    })
  })
})

describe('OperationExecutor — 감사 로그', () => {
  it('성공한 실행을 기록한다', async () => {
    const h = createHarness()

    await h.executor.run(request(), USER)

    expect(h.log.recent(1)[0]).toMatchObject({
      outcome: 'allowed',
      requestId: 'req-1',
      connectionId: 'conn-1',
      actorType: 'user',
      actorId: null,
      statement: 'SELECT 1',
    })
  })

  it('AI 문장을 원문 그대로 남긴다', async () => {
    const h = createHarness()
    const sql = "SELECT * FROM t WHERE x = 'a;b' -- 주석"

    await h.executor.run(request({ operation: { kind: 'sql', sql } }), AI)

    expect(h.log.recent(1)[0]?.statement).toBe(sql)
  })

  it('schema 요청도 무엇을 했는지 남긴다', async () => {
    const h = createHarness()

    await h.executor.run(
      request({ operation: { kind: 'schema', op: 'listTables', schema: 'public' } }),
      USER,
    )

    expect(h.log.recent(1)[0]?.statement).toContain('listTables')
  })

  it('사용자 경로에는 actorId를 남기지 않는다', async () => {
    const h = createHarness()

    await h.executor.run(request(), USER)

    expect(h.log.recent(1)[0]?.actorId).toBeNull()
  })
})
