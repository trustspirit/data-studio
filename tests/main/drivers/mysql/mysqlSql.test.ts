import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import mysql from 'mysql2/promise'
import { MysqlSqlCapability } from '@main/drivers/mysql/MysqlSqlCapability'
import { MYSQL_AVAILABLE, MYSQL_URL } from '../../../contract/mysqlTestEnv'
import type { MysqlClientLike } from '@main/drivers/mysql/MysqlDriver'
import type { ExecutionContext } from '@main/core/driver/ExecutionContext'

const ctx = (): ExecutionContext => ({ requestId: 'r1', signal: new AbortController().signal })
const PAGE = { cursor: null, maxRows: 1000, maxBytes: 8_000_000 }

describe('MysqlSqlCapability.classify (서버 불필요)', () => {
  it('SELECT는 read, DELETE는 write', () => {
    const cap = new MysqlSqlCapability(
      () => {
        throw new Error('no conn')
      },
      async () => {},
      'mysql',
    )
    expect(cap.classify('SELECT 1')).toBe('read')
    expect(cap.classify('DELETE FROM users')).toBe('write')
  })
})

describe.skipIf(!MYSQL_AVAILABLE)('MysqlSqlCapability (실서버)', () => {
  const url = new URL(MYSQL_URL)
  let conn: MysqlClientLike
  let cap: MysqlSqlCapability

  beforeAll(async () => {
    const raw = await mysql.createConnection({
      host: url.hostname,
      port: Number(url.port),
      user: url.username,
      password: decodeURIComponent(url.password),
      database: url.pathname.slice(1),
      dateStrings: true,
      supportBigNumbers: true,
      bigNumberStrings: true,
    })
    conn = raw as unknown as MysqlClientLike
    await raw.query('DROP TABLE IF EXISTS cap_nums')
    await raw.query('CREATE TABLE cap_nums (id int primary key)')
    await raw.query('INSERT INTO cap_nums VALUES (1),(2),(3),(4),(5)')
    await raw.query('DROP TABLE IF EXISTS cap_w')
    await raw.query('CREATE TABLE cap_w (id int primary key)')
    await raw.query('INSERT INTO cap_w VALUES (1),(2)')
    cap = new MysqlSqlCapability(() => conn, async () => {}, 'mysql')
  })
  afterAll(async () => {
    await conn.query('DROP TABLE IF EXISTS cap_nums')
    await conn.query('DROP TABLE IF EXISTS cap_w')
    await conn.end()
  })

  it('SELECT 결과와 requestId를 돌려준다', async () => {
    const rs = await cap.execute(ctx(), 'SELECT id FROM cap_nums ORDER BY id', PAGE)
    expect(rs.requestId).toBe('r1')
    expect(rs.rows.length).toBe(5)
    expect(structuredClone(rs)).toBeTruthy()
  })

  it('이미 abort된 컨텍스트는 거부', async () => {
    const ac = new AbortController()
    ac.abort()
    await expect(cap.execute({ requestId: 'r', signal: ac.signal }, 'SELECT 1', PAGE)).rejects.toThrow()
  })

  it('한 행씩 커서 페이지네이션이 전체 읽기와 같다', async () => {
    const all: number[] = []
    let cursor: string | null = null
    for (let i = 0; i < 200; i++) {
      const rs: Awaited<ReturnType<typeof cap.execute>> = await cap.execute(
        ctx(),
        'SELECT id FROM cap_nums ORDER BY id',
        { cursor, maxRows: 1, maxBytes: 8_000_000 },
      )
      for (const row of rs.rows) {
        const v = row[0]
        if (v && typeof v === 'object' && 'v' in v) all.push(Number((v as { v: unknown }).v))
      }
      cursor = rs.page.cursor
      if (!cursor) break
    }
    expect(all).toEqual([1, 2, 3, 4, 5])
  })

  it('garbage/foreign 커서를 거부', async () => {
    await expect(
      cap.execute(ctx(), 'SELECT id FROM cap_nums', {
        cursor: 'garbage',
        maxRows: 10,
        maxBytes: 8_000_000,
      }),
    ).rejects.toThrow()
    const rs = await cap.execute(ctx(), 'SELECT id FROM cap_nums ORDER BY id', {
      cursor: null,
      maxRows: 1,
      maxBytes: 8_000_000,
    })
    const foreignCursor = rs.page.cursor
    if (foreignCursor) {
      await expect(
        cap.execute(ctx(), 'SELECT id FROM cap_w ORDER BY id', {
          cursor: foreignCursor,
          maxRows: 1,
          maxBytes: 8_000_000,
        }),
      ).rejects.toThrow()
    }
  })

  it('쓰기는 rowsAffected를 담고 커서를 안 낸다', async () => {
    const rs = await cap.execute(ctx(), 'UPDATE cap_w SET id = id + 100', PAGE)
    expect(rs.meta.rowsAffected).toBe(2)
    expect(rs.page.cursor).toBeNull()
    await conn.query('UPDATE cap_w SET id = id - 100') // restore
  })
})
