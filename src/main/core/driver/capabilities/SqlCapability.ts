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
  /**
   * 범위 안에서 문장을 실행한다.
   *
   * `params`를 받는 이유: AI 경로가 이 메서드의 **유일한** 소비자다. 여기에
   * 파라미터 자리가 없으면 AI가 파라미터 바인딩을 쓸 수 없고, 값을 문자열로
   * 이어 붙이도록 떠밀린다 — 파라미터가 존재하는 이유가 바로 그걸 피하기
   * 위해서다.
   */
  execute(
    ctx: ExecutionContext,
    sql: string,
    page: PageRequest,
    params?: readonly unknown[],
  ): Promise<ResultSet>
  end(): Promise<void>
}

export interface SqlCapability {
  /**
   * 문장을 실행한다. `classify(sql)`이 `'write'`를 보고하는 문장도 이
   * 메서드로 실행한다 — 결과의 `meta.rowsAffected`가 영향받은 행 수를
   * 담는다(엔진이 보고하지 않으면 `null`).
   */
  execute(
    ctx: ExecutionContext,
    sql: string,
    page: PageRequest,
    params?: readonly unknown[],
  ): Promise<ResultSet>

  /**
   * 선택적 멤버다 — 엔진이 실행 계획 조회를 지원하지 않으면 이 멤버를
   * 구현하지 않는다. 존재 자체가 지원의 증거이므로(`Driver.ts` 참고),
   * 호출자는 항상 `driver.sql?.explain`으로 존재를 확인한 뒤 호출해야 한다.
   */
  explain?(ctx: ExecutionContext, sql: string, opts: ExplainOptions): Promise<ExplainPlan>

  /**
   * DB 수준 읽기 전용 트랜잭션을 연다(PostgreSQL `BEGIN READ ONLY`,
   * MySQL `START TRANSACTION READ ONLY` 등).
   *
   * 선택적 멤버다 — 엔진이 이를 지원하지 않으면 이 멤버 자체를 구현하지
   * 않는다. `sql` 객체 존재가 곧 `beginReadOnly` 지원을 뜻하지는 않으므로,
   * 호출자는 항상 `driver.sql?.beginReadOnly`로 존재를 확인한 뒤 호출해야
   * 한다. 부재는 "이 엔진은 DB 수준 읽기 전용 트랜잭션을 지원하지 않는다"는
   * 뜻이다 — 조용히 일반 트랜잭션으로 대체해 구현하는 것은 여전히 금지된다,
   * AI 읽기 전용 보장이 무너진 채로 안전해 보이게 되기 때문이다.
   */
  beginReadOnly?(ctx: ExecutionContext): Promise<ReadOnlyScope>

  /** 엔진 문법에 맞춰 문장을 분류한다. 확신할 수 없으면 'unknown'. */
  classify(sql: string): StatementClassification
}
