import type { ImpactAnalysis } from '../core/execution/WriteProposalStore'
import type { StatementClassification } from '../core/driver/capabilities/SqlCapability'

/**
 * v1 최소 impact. estimatedRows는 null(정확한 영향 행수 추정은 후속) — 제안서의
 * 본질은 사용자가 원문 SQL을 보고 승인하는 것이다(§4.3). summary는 분류 요약만.
 */
export function describeImpact(statement: string, classification: StatementClassification): ImpactAnalysis {
  const head = statement.trimStart().split(/\s+/, 1)[0]?.toUpperCase() ?? ''
  return { summary: `${classification} statement (${head})`, estimatedRows: null }
}
