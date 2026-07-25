import { z } from 'zod'
import { runOp } from './getSchema'
import type { AiTool } from '../AiTool'

const input = z.object({
  connectionId: z.string().min(1),
  schema: z.string(),
  table: z.string(),
})

/**
 * 값싼 통계만. SQL 문자열을 조립하지 않고 기존 schema 연산 결과의
 * `TableInfo.estimatedRows` / `TableDetail.sizeBytes`를 그대로 쓴다 —
 * 식별자 인젝션 벡터가 없다. 없으면 null.
 */
export const getTableStatsTool: AiTool<z.infer<typeof input>> = {
  name: 'get_table_stats',
  description: 'Best-effort row-count estimate and byte size for a table. Fields are null when the engine does not report them.',
  inputSchema: input,
  execute: async (i, ctx) => {
    const listed = await runOp(ctx, i.connectionId, { kind: 'schema', op: 'listTables', schema: i.schema })
    let estimatedRows: number | null = null
    if (listed.ok && listed.payload.kind === 'tables') {
      const found = listed.payload.tables.find((t) => t.name === i.table)
      estimatedRows = found?.estimatedRows ?? null
    }
    const detail = await runOp(ctx, i.connectionId, { kind: 'schema', op: 'describeTable', schema: i.schema, table: i.table })
    let sizeBytes: number | null = null
    if (detail.ok && detail.payload.kind === 'tableDetail') {
      // TableDetail 타입에는 아직 sizeBytes가 없다(현재 스키마 타입 범위 밖 —
      // 이 작업은 src/main/ai/tools/**만 건드리므로 shared 타입 확장은 하지
      // 않는다). 드라이버가 언젠가 채워 넣을 수 있도록 방어적으로 읽는다.
      sizeBytes = (detail.payload.detail as { sizeBytes?: number | null }).sizeBytes ?? null
    }
    return { ok: true, data: { estimatedRows, sizeBytes } }
  },
}
