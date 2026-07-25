import { describe, it, expect, vi } from 'vitest'
import { listConnectionsTool } from '@main/ai/tools/listConnections'
import { getSchemaTool, toToolResult } from '@main/ai/tools/getSchema'
import { getTableStatsTool } from '@main/ai/tools/getTableStats'
import { explainQueryTool } from '@main/ai/tools/explainQuery'
import type { AiToolContext } from '@main/ai/AiToolContext'
import type {
  OperationExecutor,
  OperationResult,
} from '@main/core/execution/OperationExecutor'
import type { WriteProposalStore } from '@main/core/execution/WriteProposalStore'
import type { ResultSet } from '@shared/types/resultSet'

type RunFn = OperationExecutor['run']

function ctxWith(over: Partial<AiToolContext> & { run?: RunFn }): AiToolContext {
  const run: RunFn =
    over.run ??
    (() => Promise.resolve<OperationResult>({ ok: true, payload: { kind: 'rows', rows: emptyRows() } }))
  return {
    executor: { run: vi.fn(run) } as unknown as OperationExecutor,
    connections: over.connections ?? { list: () => Promise.resolve([]), get: () => Promise.resolve(null) },
    proposals: {} as unknown as WriteProposalStore,
    redactor: { redact: (req) => req.resultSet },
    sessionId: 's1',
    aiActor: () => ({ type: 'ai', sessionId: 's1' }),
    newRequestId: () => 'req1',
    ...over,
  }
}
function emptyRows(): ResultSet {
  return { requestId: 'r', columns: [], rows: [], page: { cursor: null, hasMore: false, rowCount: 0, bytes: 0 }, meta: { durationMs: 0, truncatedRows: false, truncatedBytes: false, rowsAffected: null } }
}

describe('metadata tools', () => {
  it('list_connections는 id/name/engine만 노출한다', async () => {
    const ctx = ctxWith({ connections: { list: () => Promise.resolve([{ id: 'c1', name: 'db', engine: 'postgres', host: 'secret-host', port: 5432, database: 'd', username: 'u', tlsMode: 'disable', aiReadOnlyUsername: null, maskedColumnPatterns: [] }]), get: () => Promise.resolve(null) } })
    const out = await listConnectionsTool.execute({}, ctx)
    expect(out).toEqual({ ok: true, data: [{ id: 'c1', name: 'db', engine: 'postgres' }] })
  })

  it('get_schema는 schema Operation을 AI actor로 실행한다', async () => {
    const run = vi.fn((): Promise<OperationResult> => Promise.resolve({ ok: true, payload: { kind: 'tables', tables: [{ schema: 'public', name: 't', kind: 'table', estimatedRows: 5 }] } }))
    const ctx = ctxWith({ run })
    const out = await getSchemaTool.execute({ connectionId: 'c1', schema: 'public' }, ctx)
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ connectionId: 'c1', operation: { kind: 'schema', op: 'listTables', schema: 'public' } }),
      { type: 'ai', sessionId: 's1' },
    )
    expect(out.ok).toBe(true)
  })

  it('get_table_stats는 estimatedRows를 listTables 결과에서 뽑는다', async () => {
    const run = vi.fn((): Promise<OperationResult> => Promise.resolve({ ok: true, payload: { kind: 'tables', tables: [{ schema: 'public', name: 't', kind: 'table', estimatedRows: 42 }] } }))
    const ctx = ctxWith({ run })
    const out = await getTableStatsTool.execute({ connectionId: 'c1', schema: 'public', table: 't' }, ctx)
    expect(out).toEqual({ ok: true, data: { estimatedRows: 42 } })
  })

  it('get_table_stats는 테이블을 못 찾으면 estimatedRows: null', async () => {
    const run = vi.fn((): Promise<OperationResult> => Promise.resolve({ ok: true, payload: { kind: 'tables', tables: [] } }))
    const ctx = ctxWith({ run })
    const out = await getTableStatsTool.execute({ connectionId: 'c1', schema: 'public', table: 'missing' }, ctx)
    expect(out).toEqual({ ok: true, data: { estimatedRows: null } })
  })

  it('explain_query는 EXPLAIN 접두 sql을 실행한다', async () => {
    const run = vi.fn((): Promise<OperationResult> => Promise.resolve({ ok: true, payload: { kind: 'rows', rows: emptyRows() } }))
    const ctx = ctxWith({ run })
    await explainQueryTool.execute({ connectionId: 'c1', sql: 'SELECT 1' }, ctx)
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ operation: { kind: 'sql', sql: 'EXPLAIN SELECT 1' } }),
      { type: 'ai', sessionId: 's1' },
    )
  })

  it('실행이 거부되면 ok:false', async () => {
    const ctx = ctxWith({ run: () => Promise.resolve<OperationResult>({ ok: false, reason: 'capability_missing' }) })
    const out = await getSchemaTool.execute({ connectionId: 'c1' }, ctx)
    expect(out.ok).toBe(false)
  })

  it('실패 결과에 원문이 실려 있어도 도구 출력에는 넣지 않는다', () => {
    // detail은 사용자 화면 전용이다. 지금은 AI actor에게 채워지지 않지만,
    // 그 조건은 OperationExecutor의 한 줄이다. 읽는 쪽에도 가드를 둬서
    // 두 곳이 동시에 틀려야 유출이 되게 만든다.
    const out = toToolResult({
      ok: false,
      reason: 'error',
      detail: "duplicate key: email='alice@example.com'",
    })

    expect(JSON.stringify(out)).not.toContain('alice@example.com')
    expect(out).toEqual({ ok: false, error: 'operation denied or failed: error' })
  })
})
