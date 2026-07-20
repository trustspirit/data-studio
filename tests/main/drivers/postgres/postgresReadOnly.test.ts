import { describe, expect, it } from 'vitest'
import type { ConnectionConfig } from '@shared/types/connection'
import type { ExecutionContext } from '@main/core/driver/ExecutionContext'
import { createPostgresDriver } from '@main/drivers/postgres'
import type { PgClientLike } from '@main/drivers/postgres'
import { PG_AVAILABLE, TEST_DB_URL, withSchema } from '../../../contract/pgTestEnv'

function config(): ConnectionConfig {
  const u = new URL(TEST_DB_URL)
  return {
    id: 'pg-ro-1', name: 'pg', engine: 'postgres', host: u.hostname, port: Number(u.port),
    database: u.pathname.slice(1), username: decodeURIComponent(u.username),
    tlsMode: 'disable', aiReadOnlyUsername: null, maskedColumnPatterns: [],
  }
}
const PASSWORD = decodeURIComponent(new URL(TEST_DB_URL).password)
function ctx(): ExecutionContext { return { requestId: 'r', signal: new AbortController().signal } }
const PAGE = { cursor: null, maxRows: 1000, maxBytes: 8 * 1024 * 1024 }

describe.skipIf(!PG_AVAILABLE)('PostgresDriver beginReadOnly (실제 pg 필요)', () => {
  it('읽기는 되지만 쓰기는 PG가 거부한다 (일반 트랜잭션 대체 아님)', async () => {
    await withSchema(
      'CREATE TABLE t (id int primary key); INSERT INTO t VALUES (1);',
      async (schema) => {
        const d = createPostgresDriver(config(), { getPassword: () => Promise.resolve(PASSWORD) })
        await d.connect(config())
        try {
          // 대조: RO 밖에서는 INSERT가 성공한다 — 거부가 RO 때문임을 못 박는다.
          const outside = await d.sql.execute(ctx(), `INSERT INTO ${schema}.t VALUES (99)`, PAGE)
          expect(outside.meta.rowsAffected).toBe(1)

          const scope = await d.sql.beginReadOnly!(ctx())
          try {
            const read = await scope.execute(ctx(), `SELECT count(*)::int AS c FROM ${schema}.t`, PAGE)
            expect(read.rows).toHaveLength(1)
            // RO 안에서 INSERT는 PG가 거부한다.
            await expect(
              scope.execute(ctx(), `INSERT INTO ${schema}.t VALUES (100)`, PAGE),
            ).rejects.toThrow(/read-only/i)
          } finally {
            await scope.end()
          }
        } finally {
          await d.disconnect()
        }
      },
    )
  })
})

/**
 * BEGIN은 성공하지만 그 뒤(SET LOCAL statement_timeout) 실패하는 상황을 스텁으로
 * 결정적으로 재현한다. 이 드라이버는 커넥션을 풀링하지 않고 단일 커넥션만 쓰므로,
 * BEGIN 이후 실패를 ROLLBACK 없이 그냥 던지면 그 커넥션은 "aborted transaction"
 * 상태로 갇혀 이후 모든 실행(RO scope뿐 아니라 일반 execute까지)이 막힌다.
 * 라이브 pg가 없어도 되므로 skipIf로 걸지 않는다.
 */
function makeStubClient(): { client: PgClientLike; received: string[] } {
  const received: string[] = []
  const client: PgClientLike = {
    connect: () => Promise.resolve(),
    end: () => Promise.resolve(),
    query: (cfg: { text: string }) => {
      received.push(cfg.text)
      if (cfg.text.includes('statement_timeout')) {
        return Promise.reject(new Error('boom: SET LOCAL statement_timeout failed (simulated)'))
      }
      return Promise.resolve({ rows: [], fields: [], rowCount: null, command: 'OK' })
    },
    processID: 999,
  }
  return { client, received }
}

describe('PostgresDriver beginReadOnly 설정 실패 (스텁, 라이브 pg 불필요)', () => {
  it('SET LOCAL statement_timeout이 실패하면 ROLLBACK으로 트랜잭션을 닫는다', async () => {
    const { client, received } = makeStubClient()
    const d = createPostgresDriver(config(), {
      getPassword: () => Promise.resolve(PASSWORD),
      createClient: () => client,
    })
    await d.connect(config())
    try {
      await expect(d.sql.beginReadOnly!(ctx())).rejects.toThrow(/statement_timeout/i)
      expect(received).toContain('BEGIN TRANSACTION READ ONLY')
      // 실패 후 커넥션을 되돌려놨어야 한다 — 아니면 이후 모든 실행이
      // "current transaction is aborted" 상태로 막힌다.
      expect(received).toContain('ROLLBACK')
    } finally {
      await d.disconnect()
    }
  })
})
