import type { MysqlClientLike } from './MysqlDriver'

/**
 * side 커넥션에서 `KILL QUERY <threadId>`를 실행해 실행 중인 문장만 죽인다(커넥션은 유지).
 * 주 커넥션은 바빠서 자기 자신을 취소할 수 없다 — pgCancel과 동일한 이유.
 * threadId는 파라미터 바인딩이 안 되므로 정수임을 검증한 뒤 문자열로 삽입한다.
 * best-effort: side 커넥션 실패는 삼킨다(이 층엔 logger가 없다).
 */
export async function cancelQuery(
  makeConn: () => Promise<MysqlClientLike>,
  threadId: number,
): Promise<void> {
  if (!Number.isInteger(threadId)) throw new Error(`invalid threadId: ${String(threadId)}`)
  let conn: MysqlClientLike | null = null
  try {
    conn = await makeConn()
    await conn.query(`KILL QUERY ${threadId}`)
  } catch {
    // best-effort — swallow
  } finally {
    if (conn) {
      try {
        await conn.end()
      } catch {
        // ignore
      }
    }
  }
}
