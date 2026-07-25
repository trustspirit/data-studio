import { z } from 'zod'
import { classifyStatement } from '../../core/execution/StatementClassifier'
import { describeImpact } from '../proposalImpact'
import type { AiTool } from '../AiTool'

const input = z.object({
  connectionId: z.string().min(1),
  sql: z.string().min(1),
})

/**
 * 쓰기를 제안만 한다 — 실행하지 않는다. main의 WriteProposalStore에 원문을
 * 보관하고 proposalId+표시용 뷰를 반환한다. 실행은 사용자 승인 후 기존 consume
 * 경로(6c)에서, renderer가 보낸 SQL이 아니라 보관된 원문으로만 이뤄진다.
 */
export const proposeWriteTool: AiTool<z.infer<typeof input>> = {
  name: 'propose_write',
  description: 'Propose a write (INSERT/UPDATE/DELETE/DDL) for user approval. Does NOT execute.',
  inputSchema: input,
  execute: (i, ctx) => {
    const view = ctx.proposals.propose({
      connectionId: i.connectionId,
      statement: i.sql,
      kind: 'write',
      impact: describeImpact(i.sql, classifyStatement(i.sql)),
    })
    return Promise.resolve({ ok: true, data: { proposalId: view.proposalId, statement: view.statement, impact: view.impact, expiresAt: view.expiresAt, kind: view.kind } })
  },
}
