import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import mysql from 'mysql2/promise'
import { MysqlDataCapability } from '@main/drivers/mysql/MysqlDataCapability'
import { MYSQL_AVAILABLE, MYSQL_URL } from '../../../contract/mysqlTestEnv'
import type { RowChange } from '@shared/types/operation'
import type { ExecutionContext } from '@main/core/driver/ExecutionContext'
import type { MysqlClientLike } from '@main/drivers/mysql/MysqlDriver'

function ctx(): ExecutionContext {
  return { requestId: 'd', signal: new AbortController().signal, resolveColumnOrigins: false }
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

/** query에 넘어간 바인딩 값만 기록하는 스텁. 파라미터 변환은 서버 없이도 검증된다. */
function stubConn(): { conn: MysqlClientLike; params: unknown[][] } {
  const params: unknown[][] = []
  const conn = {
    query: (sql: string | { sql: string }, values?: readonly unknown[]) => {
      if (typeof sql === 'string' && !/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)) {
        params.push([...(values ?? [])])
      }
      return Promise.resolve([{ affectedRows: 1 }, null])
    },
    end: () => Promise.resolve(),
    threadId: 1,
    beginTransaction: () => Promise.resolve(),
    commit: () => Promise.resolve(),
    rollback: () => Promise.resolve(),
  } as unknown as MysqlClientLike
  return { conn, params }
}

describe('MysqlDataCapability 파라미터 바인딩 (서버 불필요)', () => {
  it('bytes는 base64 문자열이 아니라 디코드한 바이트로 바인딩한다', async () => {
    // 그대로 넘기면 BLOB 컬럼에 'AQL/'이라는 ASCII가 저장된다.
    // mysql2는 Buffer를 X'0102ff' hex 리터럴로 이스케이프한다.
    const { conn, params } = stubConn()
    const cap = new MysqlDataCapability(() => conn)
    await cap.applyChanges(ctx(), 'db', 't', [
      { op: 'insert', values: { blob: { t: 'bytes', v: 'AQL/', enc: 'base64', truncated: false } } },
    ])
    expect(params[0]?.[0]).toBeInstanceOf(Buffer)
    expect([...(params[0]?.[0] as Buffer)]).toEqual([0x01, 0x02, 0xff])
  })

  it('이진 PK도 바이트로 바인딩한다 — 안 그러면 0행 삭제가 성공으로 보고된다', async () => {
    const { conn, params } = stubConn()
    const cap = new MysqlDataCapability(() => conn)
    await cap.applyChanges(ctx(), 'db', 't', [
      { op: 'delete', pk: { id: { t: 'bytes', v: 'AAEC', enc: 'base64', truncated: false } } },
    ])
    expect([...(params[0]?.[0] as Buffer)]).toEqual([0x00, 0x01, 0x02])
  })

  it('잘린 bytes는 되쓰기를 거부한다 (남은 바이트를 복원할 수 없다)', async () => {
    const { conn } = stubConn()
    const cap = new MysqlDataCapability(() => conn)
    await expect(
      cap.applyChanges(ctx(), 'db', 't', [
        { op: 'insert', values: { blob: { t: 'bytes', v: 'AQL/', enc: 'base64', truncated: true } } },
      ]),
    ).rejects.toThrow(/truncated/)
  })

  it('bool은 1/0, bigint·decimal·date는 문자열 그대로', async () => {
    const { conn, params } = stubConn()
    const cap = new MysqlDataCapability(() => conn)
    await cap.applyChanges(ctx(), 'db', 't', [
      {
        op: 'insert',
        values: {
          flag: { t: 'bool', v: true },
          big: { t: 'bigint', v: '9223372036854775807' },
          amount: { t: 'decimal', v: '0.10' },
          at: { t: 'date', v: '2024-01-15 12:00:00' },
        },
      },
    ])
    expect(params[0]).toEqual([1, '9223372036854775807', '0.10', '2024-01-15 12:00:00'])
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
      cap.applyChanges({ requestId: 'd', signal: c.signal, resolveColumnOrigins: false }, db, 'd_t', [
        { op: 'delete', pk: { id: { t: 'int', v: 1 } } },
      ]),
    ).rejects.toThrow()
  })
})
