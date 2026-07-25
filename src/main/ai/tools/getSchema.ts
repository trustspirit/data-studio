import { z } from 'zod'
import { connectionIdSchema } from '@shared/types/connection'
import type { Operation } from '@shared/types/operation'
import type { OperationResult } from '../../core/execution/OperationExecutor'
import type { AiTool, ToolResult } from '../AiTool'
import type { AiToolContext } from '../AiToolContext'

/** Operation 하나를 AI actor로 관문 실행한다. tool 공통 진입점. */
export async function runOp(ctx: AiToolContext, connectionId: string, operation: Operation): Promise<OperationResult> {
  return ctx.executor.run(
    { requestId: ctx.newRequestId(), connectionId, operation },
    ctx.aiActor(),
  )
}

/** OperationResult를 ToolResult로 옮긴다. 실패 사유는 안전한 요약만. */
export function toToolResult(result: OperationResult): ToolResult {
  if (!result.ok) return { ok: false, error: `operation denied or failed: ${result.reason}` }
  return { ok: true, data: result.payload }
}

const input = z.object({
  connectionId: connectionIdSchema,
  schema: z.string().optional(),
  table: z.string().optional(),
})

export const getSchemaTool: AiTool<z.infer<typeof input>> = {
  name: 'get_schema',
  description: 'List schemas/tables, or describe one table (columns, indexes, foreign keys).',
  inputSchema: input,
  execute: async (i, ctx) => {
    const op: Operation =
      i.table !== undefined && i.schema !== undefined
        ? { kind: 'schema', op: 'describeTable', schema: i.schema, table: i.table }
        : i.schema !== undefined
          ? { kind: 'schema', op: 'listTables', schema: i.schema }
          : { kind: 'schema', op: 'listSchemas' }
    return toToolResult(await runOp(ctx, i.connectionId, op))
  },
}
