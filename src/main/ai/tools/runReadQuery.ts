import { z } from 'zod'
import { runOp } from './getSchema'
import type { AiTool, ToolResult } from '../AiTool'

/** §4.4 AI 결과 컨텍스트 상한. */
export const AI_CONTEXT_MAX_BYTES = 100 * 1024

const input = z.object({
  connectionId: z.string().min(1),
  sql: z.string().min(1),
})

/**
 * 단일 읽기 문장을 AI actor로 실행한다. 정책이 read-only scope + classify read를
 * 강제하므로(write/unknown/다중문장/EXPLAIN ANALYZE는 여기서 거부된다), 이 tool은
 * 문장 종류를 스스로 판정하지 않는다 — 관문에 맡긴다. 성공 결과는 반드시
 * PiiRedactor(커넥션 maskedColumnPatterns) + 100KB bound를 거친 뒤 반환한다.
 */
export const runReadQueryTool: AiTool<z.infer<typeof input>> = {
  name: 'run_read_query',
  description: 'Execute a single read-only SQL statement in a read-only session and return redacted, size-bounded rows.',
  inputSchema: input,
  execute: async (i, ctx): Promise<ToolResult> => {
    const result = await runOp(ctx, i.connectionId, { kind: 'sql', sql: i.sql })
    if (!result.ok) return { ok: false, error: `query denied or failed: ${result.reason}` }
    if (result.payload.kind !== 'rows') return { ok: false, error: 'unexpected result shape' }

    const conn = await ctx.connections.get(i.connectionId)
    const patterns = conn?.maskedColumnPatterns ?? []
    const redacted = ctx.redactor.redact(result.payload.rows, patterns, AI_CONTEXT_MAX_BYTES)
    return { ok: true, data: { rows: redacted } }
  },
}
