import { z } from 'zod'
import { connectionIdSchema } from '@shared/types/connection'
import { runOp } from './getSchema'
import type { AiTool, ToolResult } from '../AiTool'

/** §4.4 AI 결과 컨텍스트 상한. */
export const AI_CONTEXT_MAX_BYTES = 100 * 1024

const input = z.object({
  connectionId: connectionIdSchema,
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
    // 마스킹 규칙을 **먼저** 확보한다. 설정을 못 찾으면 쿼리를 아예 돌리지 않는다.
    //
    // 예전에는 실행부터 하고 `conn?.maskedColumnPatterns ?? []`로 떨어졌다. 그건
    // fail-open이고, 모델이 그 상태를 스스로 만들 수 있었다: 저장된 설정에는 있을
    // 수 없는 id(파생 접미사가 붙은 풀 엔트리 등)를 넘기면 실행은 성공하는데
    // `get`은 null을 돌려줘 패턴이 빈 배열이 되고, 원본 행이 그대로 프로바이더로
    // 나갔다. 커넥션 설정이 세션 중간에 삭제된 경우도 같은 결과였다.
    const conn = await ctx.connections.get(i.connectionId)
    if (conn === null) return { ok: false, error: 'unknown connection' }

    const result = await runOp(ctx, i.connectionId, { kind: 'sql', sql: i.sql })
    if (!result.ok) return { ok: false, error: `query denied or failed: ${result.reason}` }
    if (result.payload.kind !== 'rows') return { ok: false, error: 'unexpected result shape' }

    const redacted = ctx.redactor.redact({
      resultSet: result.payload.rows,
      patterns: conn.maskedColumnPatterns,
      maxBytes: AI_CONTEXT_MAX_BYTES,
      statement: i.sql,
    })
    return { ok: true, data: { rows: redacted } }
  },
}
