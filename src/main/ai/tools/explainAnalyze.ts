import { z } from 'zod'
import { classifyStatement, splitStatements } from '../../core/execution/StatementClassifier'
import { describeImpact } from '../proposalImpact'
import type { AiTool } from '../AiTool'

const input = z.object({
  connectionId: z.string().min(1),
  sql: z.string().min(1),
})

/**
 * EXPLAIN ANALYZE는 계획만 보는 게 아니라 내부 문장을 **실제 실행**한다. 따라서
 * (1) 내부 문장이 단일 read일 때만 허용하고(write 래핑 금지), (2) 실행하지 않고
 * kind='analyze' 제안서만 만든다 — 실행은 사용자 승인 후. 정책 계층도 EXPLAIN
 * ANALYZE를 write로 분류해 AI 자율 실행을 막지만, 이 tool은 제안 단계에서
 * 내부문을 미리 검증해 사용자에게 "실제 실행" 승인을 정확히 제시한다.
 */
export const explainAnalyzeTool: AiTool<z.infer<typeof input>> = {
  name: 'explain_analyze',
  description: 'Propose an EXPLAIN ANALYZE (which actually executes the query) for user approval. Only wraps read-only statements. Does NOT execute.',
  inputSchema: input,
  execute: (i, ctx) => {
    if (splitStatements(i.sql).length !== 1) {
      return Promise.resolve({ ok: false, error: 'explain_analyze accepts a single statement' })
    }
    if (classifyStatement(i.sql) !== 'read') {
      return Promise.resolve({ ok: false, error: 'explain_analyze only wraps read-only statements' })
    }
    const statement = `EXPLAIN ANALYZE ${i.sql}`
    const view = ctx.proposals.propose({
      connectionId: i.connectionId,
      statement,
      kind: 'analyze',
      impact: describeImpact(statement, 'write'),
    })
    return Promise.resolve({ ok: true, data: { proposalId: view.proposalId, statement: view.statement, impact: view.impact, expiresAt: view.expiresAt, kind: view.kind } })
  },
}
