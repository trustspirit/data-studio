import { z } from 'zod'
import { runOp } from './getSchema'
import type { AiTool } from '../AiTool'

const input = z.object({
  connectionId: z.string().min(1),
  schema: z.string(),
  table: z.string(),
})

/**
 * 값싼 통계만. SQL 문자열을 조립하지 않고 기존 `listTables` 결과의
 * `TableInfo.estimatedRows`를 그대로 쓴다 — 식별자 인젝션 벡터가 없다.
 * 테이블을 못 찾거나 엔진이 제공하지 않으면 null.
 */
export const getTableStatsTool: AiTool<z.infer<typeof input>> = {
  name: 'get_table_stats',
  description: 'Best-effort row-count estimate for a table. Null when the table is not found or the engine does not report it.',
  inputSchema: input,
  execute: async (i, ctx) => {
    const listed = await runOp(ctx, i.connectionId, { kind: 'schema', op: 'listTables', schema: i.schema })
    let estimatedRows: number | null = null
    if (listed.ok && listed.payload.kind === 'tables') {
      const found = listed.payload.tables.find((t) => t.name === i.table)
      estimatedRows = found?.estimatedRows ?? null
    }
    return { ok: true, data: { estimatedRows } }
  },
}
