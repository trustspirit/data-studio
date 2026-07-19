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
}
