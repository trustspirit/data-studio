import { z } from 'zod'
import { connectionIdSchema } from '@shared/types/connection'
import { runOp, toToolResult } from './getSchema'
import type { AiTool } from '../AiTool'

const input = z.object({
  connectionId: connectionIdSchema,
  sql: z.string().min(1),
})

/**
 * 일반 EXPLAIN(계획만). classify가 read로 보므로 정책이 AI 자율 실행을 허용한다.
 * EXPLAIN ANALYZE는 classify가 write라 이 경로로 들어와도 정책이 거부한다 —
 * 실제 실행이 필요한 explain_analyze는 별도 제안서 tool을 쓴다.
 */
export const explainQueryTool: AiTool<z.infer<typeof input>> = {
  name: 'explain_query',
  description: 'Run a plain EXPLAIN (plan only, no execution) for a SQL statement.',
  inputSchema: input,
  execute: async (i, ctx) =>
    toToolResult(await runOp(ctx, i.connectionId, { kind: 'sql', sql: `EXPLAIN ${i.sql}` })),
}
