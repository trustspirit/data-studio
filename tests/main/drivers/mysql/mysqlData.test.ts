import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import mysql from 'mysql2/promise'
import { MysqlDataCapability } from '@main/drivers/mysql/MysqlDataCapability'
import { MYSQL_AVAILABLE, MYSQL_URL } from '../../../contract/mysqlTestEnv'
import type { RowChange } from '@shared/types/operation'
import type { ExecutionContext } from '@main/core/driver/ExecutionContext'
import type { MysqlClientLike } from '@main/drivers/mysql/MysqlDriver'

function ctx(): ExecutionContext {
  return { requestId: 'd', signal: new AbortController().signal }
}

describe('MysqlDataCapability.buildBrowse (서버 불필요)', () => {
  const cap = new MysqlDataCapability(() => {
    throw new Error('no conn')
  })

  it('정렬 없음', () => {
    expect(cap.buildBrowse('db', 't')).toEqual({ sql: 'SELECT * FROM `db`.`t`', params: [] })
  })

  it('정렬 있음', () => {
    expect(cap.buildBrowse('db', 't', { column: 'id', direction: 'desc' })).toEqual({
      sql: 'SELECT * FROM `db`.`t` ORDER BY `id` DESC',
      params: [],
    })
  })

  it('식별자에 낀 백틱을 이중화해 인젝션을 막는다', () => {
    const { sql } = cap.buildBrowse('db', 'ev`il; DROP TABLE x --')
    expect(sql).toBe('SELECT * FROM `db`.`ev``il; DROP TABLE x --`')
  })
})

describe.skipIf(!MYSQL_AVAILABLE)('MysqlDataCapability.applyChanges (실서버)', () => {
  const url = new URL(MYSQL_URL)
  let conn: MysqlClientLike
  let cap: MysqlDataCapability
  let db: string

  beforeEach(async () => {
    const raw = await mysql.createConnection(MYSQL_URL)
    conn = raw as unknown as MysqlClientLike
    db = url.pathname.slice(1)
    await raw.query('DROP TABLE IF EXISTS d_t')
    await raw.query('CREATE TABLE d_t (id int primary key, n int not null)')
    await raw.query('INSERT INTO d_t VALUES (1,10),(2,20)')
    cap = new MysqlDataCapability(() => conn)
  })

  afterAll(async () => {
    await conn.query('DROP TABLE IF EXISTS d_t')
    await conn.end()
  })

  it('INSERT/UPDATE/DELETE를 원자적으로 적용', async () => {
    const changes: RowChange[] = [
      { op: 'insert', values: { id: { t: 'int', v: 3 }, n: { t: 'int', v: 30 } } },
      { op: 'update', pk: { id: { t: 'int', v: 1 } }, set: { n: { t: 'int', v: 11 } } },
      { op: 'delete', pk: { id: { t: 'int', v: 2 } } },
    ]
    const res = await cap.applyChanges(ctx(), db, 'd_t', changes)
    expect(res.affected).toBeGreaterThanOrEqual(3)
    const [rows] = await conn.query('SELECT id, n FROM d_t ORDER BY id')
    expect(rows).toEqual([
      { id: 1, n: 11 },
      { id: 3, n: 30 },
    ])
  })

  it('중간 실패 시 전체 롤백', async () => {
    const changes: RowChange[] = [
      { op: 'update', pk: { id: { t: 'int', v: 1 } }, set: { n: { t: 'int', v: 99 } } },
      { op: 'insert', values: { id: { t: 'int', v: 1 }, n: { t: 'int', v: 0 } } }, // 중복 PK → 실패
    ]
    await expect(cap.applyChanges(ctx(), db, 'd_t', changes)).rejects.toThrow()
    const [rows] = await conn.query('SELECT n FROM d_t WHERE id = 1')
    expect((rows as { n: number }[])[0]?.n).toBe(10) // 롤백되어 원복
  })

  it('이미 취소된 컨텍스트는 applyChanges를 거부한다', async () => {
    const c = new AbortController()
    c.abort()
    await expect(
      cap.applyChanges({ requestId: 'd', signal: c.signal }, db, 'd_t', [
        { op: 'delete', pk: { id: { t: 'int', v: 1 } } },
      ]),
    ).rejects.toThrow()
  })
})
