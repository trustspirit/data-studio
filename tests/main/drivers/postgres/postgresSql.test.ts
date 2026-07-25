import { describe, expect, it } from 'vitest'
import type { ConnectionConfig } from '@shared/types/connection'
import type { ExecutionContext } from '@main/core/driver/ExecutionContext'
import { createPostgresDriver } from '@main/drivers/postgres'
import { PG_AVAILABLE, TEST_DB_URL, withSchema } from '../../../contract/pgTestEnv'

function ctx(): ExecutionContext {
  return { requestId: 'r', signal: new AbortController().signal, resolveColumnOrigins: false }
}
function configForSchema(): ConnectionConfig {
  const u = new URL(TEST_DB_URL)
  return {
    id: 'pg-sql-1', name: 'pg', engine: 'postgres', host: u.hostname, port: Number(u.port),
    database: u.pathname.slice(1), username: decodeURIComponent(u.username),
    tlsMode: 'disable', aiReadOnlyUsername: null, maskedColumnPatterns: [],
  }
}
const PASSWORD = decodeURIComponent(new URL(TEST_DB_URL).password)
function driver() {
  return createPostgresDriver(configForSchema(), { getPassword: () => Promise.resolve(PASSWORD) })
}
const PAGE = { cursor: null, maxRows: 1000, maxBytes: 8 * 1024 * 1024 }

describe.skipIf(!PG_AVAILABLE)('PostgresSqlCapability (실제 pg 필요)', () => {
  it('SELECT 결과를 WireValue 행으로 돌려준다', async () => {
    await withSchema(
      'CREATE TABLE t (id int8 primary key, amt numeric); INSERT INTO t VALUES (1, 0.10), (2, 0.20);',
      async (schema) => {
        const d = driver()
        await d.connect(configForSchema())
        try {
          const r = await d.sql.execute(ctx(), `SELECT id, amt FROM ${schema}.t ORDER BY id`, PAGE)
          expect(r.rows).toHaveLength(2)
          // int8은 bigint, numeric은 decimal — 손실 없이.
          expect(r.rows[0]).toEqual([{ t: 'bigint', v: '1' }, { t: 'decimal', v: '0.10' }])
          expect(r.meta.rowsAffected).toBeNull() // SELECT
        } finally {
          await d.disconnect()
        }
      },
    )
  })

  it('UPDATE의 rowsAffected를 보고한다', async () => {
    await withSchema(
      'CREATE TABLE t (id int primary key); INSERT INTO t VALUES (1),(2),(3);',
      async (schema) => {
        const d = driver()
        await d.connect(configForSchema())
        try {
          const r = await d.sql.execute(ctx(), `UPDATE ${schema}.t SET id = id + 10 WHERE id <= 2`, PAGE)
          expect(r.meta.rowsAffected).toBe(2)
        } finally {
          await d.disconnect()
        }
      },
    )
  })

  it('RETURNING 행이 maxRows를 넘는 쓰기 문장은 커서를 내지 않는다 (재실행 방지)', async () => {
    await withSchema(
      'CREATE TABLE t (id int primary key); INSERT INTO t VALUES (1),(2),(3);',
      async (schema) => {
        const d = driver()
        await d.connect(configForSchema())
        try {
          const r = await d.sql.execute(
            ctx(),
            `UPDATE ${schema}.t SET id = id + 100 RETURNING id`,
            { cursor: null, maxRows: 1, maxBytes: PAGE.maxBytes },
          )
          expect(r.page.cursor).toBeNull()
          expect(r.meta.rowsAffected).toBe(3)
        } finally {
          await d.disconnect()
        }
      },
    )
  })

  it('커서로 이어 읽은 시퀀스가 한 번에 읽은 것과 같다', async () => {
    await withSchema(
      'CREATE TABLE t (id int primary key); INSERT INTO t SELECT generate_series(1, 5);',
      async (schema) => {
        const d = driver()
        await d.connect(configForSchema())
        try {
          const q = `SELECT id FROM ${schema}.t ORDER BY id`
          const all = await d.sql.execute(ctx(), q, PAGE)
          const first = await d.sql.execute(ctx(), q, { cursor: null, maxRows: 2, maxBytes: PAGE.maxBytes })
          expect(first.rows).toHaveLength(2)
          expect(first.page.cursor).not.toBeNull()
          const second = await d.sql.execute(ctx(), q, { cursor: first.page.cursor, maxRows: 2, maxBytes: PAGE.maxBytes })
          const third = await d.sql.execute(ctx(), q, { cursor: second.page.cursor, maxRows: 2, maxBytes: PAGE.maxBytes })
          expect([...first.rows, ...second.rows, ...third.rows]).toEqual(all.rows)
        } finally {
          await d.disconnect()
        }
      },
    )
  })
})

describe('PostgresSqlCapability.classify (순수, 서버 불필요)', () => {
  it('코어 classifyStatement에 위임한다', () => {
    const d = createPostgresDriver(configForSchema(), { getPassword: () => Promise.resolve('x') })
    expect(d.sql.classify('SELECT 1')).toBe('read')
    expect(d.sql.classify('DELETE FROM t')).toBe('write')
    // 코어 분류기가 최엄격으로 판정하는 케이스가 그대로 반영된다.
    expect(d.sql.classify('SELECT 1; DROP TABLE t')).toBe('write')
  })
})
