import type { PageRequest, ResultSet } from '../../../../shared/types/resultSet'
import type { ExecutionContext } from '../ExecutionContext'

/**
 * 문장이 데이터를 바꾸는지에 대한 판정.
 *
 * `'unknown'`은 실패가 아니라 유효한 결과다 — 파서가 확신할 수 없는 문장
 * (사용자 정의 함수 호출 등)이 존재한다. 상위 정책은 `'unknown'`을 **쓰기로
 * 간주**해야 한다(fail-safe). 정적 분석만으로 부작용을 완전히 판정하는 것은
 * 불가능하므로, 이 판정은 방어의 한 층일 뿐 유일한 층이 아니다.
 */
export type StatementClassification = 'read' | 'write' | 'unknown'

export interface ExplainOptions {
  /** true면 실제로 쿼리를 실행한다(EXPLAIN ANALYZE). 승인 대상이다. */
  readonly analyze: boolean
}

export interface ExplainPlan {
  /** 엔진이 돌려준 계획 텍스트 */
  readonly text: string
  /** 계획을 만들 때 실제 실행이 일어났는지 */
  readonly analyzed: boolean
}

/**
 * 읽기 전용으로 고정된 실행 범위. `end()`를 부를 때까지 이 범위 안의 실행은
 * DB 수준에서 쓰기가 거부된다.
 */
export interface ReadOnlyScope {
  execute(ctx: ExecutionContext, sql: string, page: PageRequest): Promise<ResultSet>
  end(): Promise<void>
}

export interface SqlCapability {
  execute(
    ctx: ExecutionContext,
    sql: string,
    page: PageRequest,
    params?: readonly unknown[],
  ): Promise<ResultSet>

  explain(ctx: ExecutionContext, sql: string, opts: ExplainOptions): Promise<ExplainPlan>

  /**
   * DB 수준 읽기 전용 트랜잭션을 연다(PostgreSQL `BEGIN READ ONLY`,
   * MySQL `START TRANSACTION READ ONLY` 등).
   *
   * 엔진이 이를 지원하지 않으면 **던져야 한다**. 조용히 일반 트랜잭션으로
   * 대체하면 AI 읽기 전용 보장이 무너진 채로 안전해 보이게 된다.
   */
  beginReadOnly(ctx: ExecutionContext): Promise<ReadOnlyScope>

  /** 엔진 문법에 맞춰 문장을 분류한다. 확신할 수 없으면 'unknown'. */
  classify(sql: string): StatementClassification
}
