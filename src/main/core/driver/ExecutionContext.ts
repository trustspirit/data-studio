/**
 * 하나의 작업 실행에 걸리는 취소 신호와 추적 정보.
 *
 * `signal`은 사용자 취소와 timeout 양쪽에서 발화한다. 드라이버는 이를 엔진
 * 네이티브 취소(PostgreSQL `pg_cancel_backend`, MySQL `KILL QUERY` 등)로
 * 옮겨야 한다 — JS 쪽 Promise만 버리고 백엔드 쿼리를 방치하면 커넥션이
 * 점유된 채 남는다.
 */
export interface ExecutionContext {
  readonly requestId: string
  readonly signal: AbortSignal
  /**
   * 결과 컬럼의 원본 출처(`ColumnDescriptor.origin`)를 채워 달라는 요청.
   *
   * 엔진에 따라 이 정보가 공짜가 아니다 — PostgreSQL은 와이어 프로토콜로
   * 테이블 OID와 attnum만 주므로 이름을 얻으려면 카탈로그 조회가 한 번 더 든다.
   * 그래서 관문이 필요한 실행에서만 켠다(AI 읽기: 마스킹이 별칭에 속지 않으려면
   * 출처가 필요하다). 공짜로 얻는 엔진(MySQL `orgName`, SQLite
   * `sqlite3_column_origin_name`)은 이 값과 무관하게 항상 채워도 된다.
   *
   * 채우지 못했으면 `origin`을 비워 둔다 — 판정하는 쪽이 "보고 없음"을
   * 보수적으로 다룬다. 없는 출처를 지어내지 않는다.
   */
  readonly resolveColumnOrigins: boolean
}
