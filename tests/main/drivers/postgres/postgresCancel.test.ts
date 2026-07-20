import { describe, expect, it } from 'vitest'
import { Client } from 'pg'
import type { ConnectionConfig } from '@shared/types/connection'
import type { ExecutionContext } from '@main/core/driver/ExecutionContext'
import { createPostgresDriver } from '@main/drivers/postgres'
import type { PgClientLike, PgConnParams } from '@main/drivers/postgres'
import { PG_AVAILABLE, TEST_DB_URL } from '../../../contract/pgTestEnv'

function config(): ConnectionConfig {
  const u = new URL(TEST_DB_URL)
  return {
    id: 'pg-cancel-1', name: 'pg', engine: 'postgres', host: u.hostname, port: Number(u.port),
    database: u.pathname.slice(1), username: decodeURIComponent(u.username),
    tlsMode: 'disable', aiReadOnlyUsername: null, maskedColumnPatterns: [],
  }
}
const PASSWORD = decodeURIComponent(new URL(TEST_DB_URL).password)
const PAGE = { cursor: null, maxRows: 1000, maxBytes: 8 * 1024 * 1024 }

/**
 * 첫 호출(메인 커넥션, d.connect())은 진짜 pg.Client로 넘겨 정상 접속시키고,
 * 이후 호출(취소용 사이드 커넥션)은 항상 connect()에서 거부하는 가짜 클라이언트를 준다.
 * 사이드 커넥션이 실패해도 메인 쿼리와 프로세스가 영향받지 않아야 한다.
 */
function flakyCreateClient(): (params: PgConnParams) => PgClientLike {
  let calls = 0
  return (params: PgConnParams) => {
    calls += 1
    if (calls === 1) {
      return new Client({
        host: params.host,
        port: params.port,
        database: params.database,
        user: params.user,
        password: params.password,
        ssl: params.ssl,
      }) as unknown as PgClientLike
    }
    return {
      connect: () => Promise.reject(new Error('side connection refused (simulated)')),
      end: () => Promise.resolve(),
      query: () => Promise.reject(new Error('should not be queried')),
      processID: null,
    }
  }
}

describe.skipIf(!PG_AVAILABLE)('PostgresDriver 취소 (실제 pg 필요)', () => {
  it('abort가 백엔드 쿼리를 실제로 중단시키고, 커넥션은 곧바로 다시 쓸 수 있다', async () => {
    const d = createPostgresDriver(config(), { getPassword: () => Promise.resolve(PASSWORD) })
    await d.connect(config())
    try {
      const controller = new AbortController()
      const ctx: ExecutionContext = { requestId: 'slow', signal: controller.signal }
      const slow = d.sql.execute(ctx, 'SELECT pg_sleep(30)', PAGE)
      // 쿼리가 백엔드에서 돌기 시작할 시간을 준 뒤 취소.
      await new Promise((r) => setTimeout(r, 300))
      controller.abort()
      await expect(slow).rejects.toThrow() // 취소로 끝난다

      // 커넥션이 quiescent — 곧바로 다른 쿼리가 정상 실행된다.
      const ok = await d.sql.execute(
        { requestId: 'after', signal: new AbortController().signal },
        'SELECT 1',
        PAGE,
      )
      expect(ok.rows).toHaveLength(1)
    } finally {
      await d.disconnect()
    }
  }, 15000)

  it('취소용 사이드 커넥션이 실패해도 unhandled rejection 없이 메인 쿼리는 정상적으로 끝난다', async () => {
    const unhandled: unknown[] = []
    const onUnhandledRejection = (reason: unknown): void => {
      unhandled.push(reason)
    }
    process.on('unhandledRejection', onUnhandledRejection)

    const d = createPostgresDriver(config(), {
      getPassword: () => Promise.resolve(PASSWORD),
      createClient: flakyCreateClient(),
    })
    await d.connect(config())
    try {
      const controller = new AbortController()
      const ctx: ExecutionContext = { requestId: 'slow-cancel-fails', signal: controller.signal }
      // 짧은 sleep — 취소가 백엔드까지 닿지 않으므로(사이드 커넥션 실패) 메인 쿼리는
      // 그냥 끝까지 돈다. 30초를 기다리지 않도록 일부러 짧게 잡는다.
      const slow = d.sql.execute(ctx, 'SELECT pg_sleep(2)', PAGE)
      await new Promise((r) => setTimeout(r, 300))
      controller.abort()

      // 취소 사이드 커넥션은 실패하지만, 메인 쿼리 자체의 결과는 영향받지 않는다.
      const result = await slow
      expect(result.rows).toHaveLength(1)

      // 사이드 커넥션 실패가 캐치되지 않은 채 프로세스로 새어나가지 않았다.
      // (취소 hook의 rejection이 실제로 발생할 시간을 준 뒤 확인.)
      await new Promise((r) => setTimeout(r, 50))
      expect(unhandled).toEqual([])
    } finally {
      process.off('unhandledRejection', onUnhandledRejection)
      await d.disconnect()
    }
  }, 15000)
})
