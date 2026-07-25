import { describe, it, expect, vi } from 'vitest'
import { runReadQueryTool } from '@main/ai/tools/runReadQuery'
import { DefaultPiiRedactor } from '@main/ai/PiiRedactor'
import { OperationExecutor } from '@main/core/execution/OperationExecutor'
import { WriteProposalStore } from '@main/core/execution/WriteProposalStore'
import { InMemoryOperationLog } from '@main/infrastructure/execution/InMemoryOperationLog'
import { SqlCapabilityExecutor } from '@main/infrastructure/execution/SqlCapabilityExecutor'
import { SchemaCapabilityExecutor } from '@main/infrastructure/execution/SchemaCapabilityExecutor'
import { createMemoryDriver } from '@main/drivers/memory/MemoryDriver'
import type { AiToolContext } from '@main/ai/AiToolContext'
import type { OperationResult } from '@main/core/execution/OperationExecutor'
import type { ConnectionManager, LeasedConnection } from '@main/core/connection/ConnectionManager'
import type { ConnectionConfig } from '@shared/types/connection'
import { wire } from '@shared/types/wire'

function rows(cols: string[], data: string[][]) {
  return { requestId: 'r', columns: cols.map((name) => ({ name, type: 'str' })), rows: data.map((r) => r.map((v) => wire.str(v))), page: { cursor: null, hasMore: false, rowCount: data.length, bytes: 0 }, meta: { durationMs: 0, truncatedRows: false, truncatedBytes: false, rowsAffected: null } }
}
function ctxWith(run: OperationExecutor['run'], patterns: string[] = []): AiToolContext {
  return {
    executor: { run: vi.fn(run) } as unknown as OperationExecutor,
    connections: { list: () => Promise.resolve([]), get: () => Promise.resolve({ id: 'c1', name: 'n', engine: 'postgres' as const, host: '', port: 0, database: '', username: '', tlsMode: 'disable' as const, aiReadOnlyUsername: null, maskedColumnPatterns: patterns }) },
    proposals: {} as unknown as WriteProposalStore,
    redactor: new DefaultPiiRedactor(),
    sessionId: 's1',
    aiActor: () => ({ type: 'ai', sessionId: 's1' }),
    newRequestId: () => 'req1',
  }
}

describe('run_read_query', () => {
  it('sql을 AI actor로 실행하고 결과를 마스킹해 반환한다', async () => {
    const run = vi.fn((): Promise<OperationResult> => Promise.resolve({ ok: true, payload: { kind: 'rows', rows: rows(['id', 'email'], [['1', 'a@b.com']]) } }))
    const ctx = ctxWith(run, ['email'])
    const out = await runReadQueryTool.execute({ connectionId: 'c1', sql: 'SELECT * FROM users' }, ctx)
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ operation: { kind: 'sql', sql: 'SELECT * FROM users' } }),
      { type: 'ai', sessionId: 's1' },
    )
    expect(out.ok).toBe(true)
    if (out.ok) {
      const rs = (out.data as { rows: { rows: unknown[][] } }).rows
      expect(rs.rows[0]?.[1]).toEqual(wire.str('***'))
    }
  })

  it('정책이 거부하면(write 등) ok:false', async () => {
    const ctx = ctxWith(() => Promise.resolve({ ok: false, reason: 'ai_write_requires_proposal' }))
    const out = await runReadQueryTool.execute({ connectionId: 'c1', sql: 'DELETE FROM users' }, ctx)
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.error).toContain('ai_write_requires_proposal')
  })
})

describe('run_read_query — end-to-end gate (real OperationExecutor + MemoryDriver)', () => {
  // harness: 실제 OperationExecutor(실제 ExecutionPolicy) + 실제 MemoryDriver.
  // ctx.executor = 이 실제 executor. run_read_query가 관문을 진짜로 통과한다.

  const CONFIG: ConnectionConfig = {
    id: 'mem-1',
    name: 'Memory',
    engine: 'sqlite',
    host: '',
    port: 0,
    database: ':memory:',
    username: '',
    tlsMode: 'disable',
    aiReadOnlyUsername: null,
    maskedColumnPatterns: [],
  }

  async function buildCtx(): Promise<AiToolContext> {
    const driver = createMemoryDriver(CONFIG)
    await driver.connect(CONFIG)

    const lease: LeasedConnection = {
      driver,
      signal: new AbortController().signal,
      release: () => undefined,
    }

    const connections = {
      acquire: (): Promise<LeasedConnection> => Promise.resolve(lease),
      open: () => Promise.resolve(),
      capabilities: () => [],
      close: () => Promise.resolve(),
      closeAll: () => Promise.resolve(),
      status: () => 'ready' as const,
      checkHealth: () => Promise.resolve(true),
    } satisfies ConnectionManager

    let now = 1_000
    const log = new InMemoryOperationLog({ now: () => (now += 1) })
    const proposals = new WriteProposalStore({
      now: () => now,
      randomId: () => `prop-${now}`,
      hash: (text) => `hash(${text})`,
    })

    const executor = new OperationExecutor(
      connections,
      log,
      [new SqlCapabilityExecutor(), new SchemaCapabilityExecutor()],
      {
        now: () => now,
        setTimeout: () => 0,
        clearTimeout: () => undefined,
      },
      proposals,
    )

    let requestSeq = 0

    return {
      executor,
      connections: { list: () => Promise.resolve([]), get: (id) => Promise.resolve(id === CONFIG.id ? CONFIG : null) },
      proposals,
      redactor: new DefaultPiiRedactor(),
      sessionId: 's1',
      aiActor: () => ({ type: 'ai', sessionId: 's1' }),
      newRequestId: () => `req-${(requestSeq += 1)}`,
    }
  }

  it('SELECT는 성공하고 행을 반환한다', async () => {
    const ctx = await buildCtx()
    const out = await runReadQueryTool.execute({ connectionId: CONFIG.id, sql: 'SELECT * FROM public.contract_probe' }, ctx)
    expect(out.ok).toBe(true)
    if (out.ok) {
      const rs = (out.data as { rows: { rows: unknown[][] } }).rows
      expect(rs.rows.length).toBeGreaterThan(0)
    }
  })

  it('AI write(DELETE)는 ai_write_requires_proposal로 거부된다', async () => {
    const ctx = await buildCtx()
    const out = await runReadQueryTool.execute({ connectionId: CONFIG.id, sql: 'DELETE FROM public.contract_probe' }, ctx)
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.error).toContain('ai_write_requires_proposal')
  })

  it('다중 문장은 ai_multi_statement로 거부된다', async () => {
    const ctx = await buildCtx()
    const out = await runReadQueryTool.execute({ connectionId: CONFIG.id, sql: 'SELECT 1; SELECT 2' }, ctx)
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.error).toContain('ai_multi_statement')
  })

  it('EXPLAIN ANALYZE는 거부된다(classify=write)', async () => {
    const ctx = await buildCtx()
    const out = await runReadQueryTool.execute({ connectionId: CONFIG.id, sql: 'EXPLAIN ANALYZE SELECT 1' }, ctx)
    expect(out.ok).toBe(false)
  })

  it('커넥션 설정을 못 찾으면 쿼리를 돌리지 않는다 (마스킹 fail-closed)', async () => {
    // 예전에는 실행부터 하고 패턴을 빈 배열로 떨어뜨렸다. 그래서 설정을 찾을 수
    // 없는 id를 넘기면 원본 행이 마스킹 없이 프로바이더로 나갔다. 실행 자체가
    // 일어나지 않아야 한다 — 마스킹 규칙 없이 데이터를 꺼내는 경로를 없애는 것이
    // 요점이므로, "실행했지만 가렸다"로는 부족하다.
    const ctx = await buildCtx()
    const runSpy = vi.spyOn(ctx.executor, 'run')
    const out = await runReadQueryTool.execute({ connectionId: 'no-such-connection', sql: 'SELECT 1' }, ctx)
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.error).toBe('unknown connection')
    expect(runSpy).not.toHaveBeenCalled()
  })

  it('파생 접미사가 붙은 connectionId는 tool 인자 스키마가 거부한다', () => {
    // `{id}::ai`는 AI 읽기 전용 계정의 풀 엔트리를 가리키는 main 내부 규약이다.
    // 그 id로는 저장된 설정을 찾을 수 없으므로, 통과시키면 위의 fail-open을
    // 모델이 스스로 만들어 낼 수 있었다. IPC 경계와 같은 스키마로 막는다.
    const parsed = runReadQueryTool.inputSchema.safeParse({
      connectionId: `${CONFIG.id}::ai`,
      sql: 'SELECT 1',
    })
    expect(parsed.success).toBe(false)
  })
})
