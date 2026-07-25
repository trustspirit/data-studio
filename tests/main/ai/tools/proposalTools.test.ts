import { describe, it, expect, vi } from 'vitest'
import { proposeWriteTool } from '@main/ai/tools/proposeWrite'
import { explainAnalyzeTool } from '@main/ai/tools/explainAnalyze'
import type { AiToolContext } from '@main/ai/AiToolContext'

function ctxWith() {
  const propose = vi.fn((inp: any) => ({ proposalId: 'p1', connectionId: inp.connectionId, statement: inp.statement, statementHash: 'h', kind: inp.kind, impact: inp.impact, expiresAt: 1 }))
  const ctx = {
    executor: { run: vi.fn() } as any,
    connections: { list: async () => [], get: async () => null },
    proposals: { propose } as any,
    redactor: { redact: (rs: any) => rs },
    sessionId: 's1',
    aiActor: () => ({ type: 'ai', sessionId: 's1' }),
    newRequestId: () => 'req1',
  } as AiToolContext
  return { ctx, propose }
}

describe('propose_write', () => {
  it('kind=write 제안서를 만들고 실행하지 않는다', async () => {
    const { ctx, propose } = ctxWith()
    const out = await proposeWriteTool.execute({ connectionId: 'c1', sql: 'DELETE FROM t' }, ctx)
    expect(propose).toHaveBeenCalledWith(expect.objectContaining({ connectionId: 'c1', statement: 'DELETE FROM t', kind: 'write' }))
    expect(ctx.executor.run).not.toHaveBeenCalled()
    expect(out).toMatchObject({ ok: true, data: { proposalId: 'p1' } })
  })
})

describe('explain_analyze', () => {
  it('내부문이 read면 kind=analyze 제안서를 만든다(EXPLAIN ANALYZE 접두)', async () => {
    const { ctx, propose } = ctxWith()
    const out = await explainAnalyzeTool.execute({ connectionId: 'c1', sql: 'SELECT * FROM t' }, ctx)
    expect(propose).toHaveBeenCalledWith(expect.objectContaining({ statement: 'EXPLAIN ANALYZE SELECT * FROM t', kind: 'analyze' }))
    expect(out.ok).toBe(true)
  })

  it('내부문이 write면 거부하고 제안서를 만들지 않는다', async () => {
    const { ctx, propose } = ctxWith()
    const out = await explainAnalyzeTool.execute({ connectionId: 'c1', sql: 'DELETE FROM t' }, ctx)
    expect(out.ok).toBe(false)
    expect(propose).not.toHaveBeenCalled()
  })

  it('다중 문장은 거부한다', async () => {
    const { ctx } = ctxWith()
    const out = await explainAnalyzeTool.execute({ connectionId: 'c1', sql: 'SELECT 1; DROP TABLE t' }, ctx)
    expect(out.ok).toBe(false)
  })
})
