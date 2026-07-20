import type { PgClientLike } from './PostgresDriver'

/**
 * 별도의 짧은 커넥션을 열어 대상 백엔드 PID에 pg_cancel_backend를 보낸다.
 * 주 커넥션에서 취소를 보낼 수 없다 — 그 커넥션은 취소할 쿼리로 이미 바쁘다.
 */
export async function cancelBackend(makeClient: () => PgClientLike, pid: number): Promise<void> {
  const side = makeClient()
  await side.connect()
  try {
    await side.query({ text: 'SELECT pg_cancel_backend($1)', values: [pid], rowMode: 'array' })
  } finally {
    await side.end()
  }
}
