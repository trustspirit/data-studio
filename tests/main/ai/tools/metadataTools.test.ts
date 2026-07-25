import { describe, it, expect, vi } from 'vitest'
import { listConnectionsTool } from '@main/ai/tools/listConnections'
import { getSchemaTool } from '@main/ai/tools/getSchema'
import { getTableStatsTool } from '@main/ai/tools/getTableStats'
import { explainQueryTool } from '@main/ai/tools/explainQuery'
import type { AiToolContext } from '@main/ai/AiToolContext'
import type { OperationResult } from '@main/core/execution/OperationExecutor'

function ctxWith(over: Partial<AiToolContext> & { run?: (req: any, actor: any) => Promise<OperationResult> }): AiToolContext {
  const run = over.run ?? (async () => ({ ok: true, payload: { kind: 'rows', rows: emptyRows() } }))
  return {
    executor: { run: vi.fn(run) } as any,
    connections: over.connections ?? { list: async () => [], get: async () => null },
    proposals: {} as any,
    redactor: { redact: (rs) => rs },
    sessionId: 's1',
    aiActor: () => ({ type: 'ai', sessionId: 's1' }),
    newRequestId: () => 'req1',
    ...over,
  }
}
function emptyRows() {
  return { requestId: 'r', columns: [], rows: [], page: { cursor: null, hasMore: false, rowCount: 0, bytes: 0 }, meta: { durationMs: 0, truncatedRows: false, truncatedBytes: false, rowsAffected: null } }
}

describe('metadata tools', () => {
  it('list_connections는 id/name/engine만 노출한다', async () => {
    const ctx = ctxWith({ connections: { list: async () => [{ id: 'c1', name: 'db', engine: 'postgres', host: 'secret-host', port: 5432, database: 'd', username: 'u', tlsMode: 'disable', aiReadOnlyUsername: null, maskedColumnPatterns: [] }], get: async () => null } })
    const out = await listConnectionsTool.execute({}, ctx)
    expect(out).toEqual({ ok: true, data: [{ id: 'c1', name: 'db', engine: 'postgres' }] })
  })

  it('get_schema는 schema Operation을 AI actor로 실행한다', async () => {
    const run = vi.fn(async () => ({ ok: true, payload: { kind: 'tables', tables: [{ schema: 'public', name: 't', kind: 'table', estimatedRows: 5 }] } }) as OperationResult)
    const ctx = ctxWith({ run })
    const out = await getSchemaTool.execute({ connectionId: 'c1', schema: 'public' }, ctx)
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ connectionId: 'c1', operation: { kind: 'schema', op: 'listTables', schema: 'public' } }),
      { type: 'ai', sessionId: 's1' },
    )
    expect(out.ok).toBe(true)
  })

  it('get_table_stats는 estimatedRows/sizeBytes를 schema 결과에서 뽑는다', async () => {
    const run = vi.fn(async () => ({ ok: true, payload: { kind: 'tableDetail', detail: { schema: 'public', name: 't', columns: [], sizeBytes: 4096 } } }) as OperationResult)
    const ctx = ctxWith({ run })
    const out = await getTableStatsTool.execute({ connectionId: 'c1', schema: 'public', table: 't' }, ctx)
    expect(out).toMatchObject({ ok: true, data: { sizeBytes: 4096 } })
  })

  it('explain_query는 EXPLAIN 접두 sql을 실행한다', async () => {
    const run = vi.fn(async () => ({ ok: true, payload: { kind: 'rows', rows: emptyRows() } }) as OperationResult)
    const ctx = ctxWith({ run })
    await explainQueryTool.execute({ connectionId: 'c1', sql: 'SELECT 1' }, ctx)
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ operation: { kind: 'sql', sql: 'EXPLAIN SELECT 1' } }),
      { type: 'ai', sessionId: 's1' },
    )
  })

  it('실행이 거부되면 ok:false', async () => {
    const ctx = ctxWith({ run: async () => ({ ok: false, reason: 'capability_missing' }) })
    const out = await getSchemaTool.execute({ connectionId: 'c1' }, ctx)
    expect(out.ok).toBe(false)
  })
})
