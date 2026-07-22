import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import mysql from 'mysql2/promise'
import { MysqlSqlCapability } from '@main/drivers/mysql/MysqlSqlCapability'
import { MYSQL_AVAILABLE, MYSQL_URL, MARIADB_AVAILABLE, MARIADB_URL } from '../../../contract/mysqlTestEnv'
import type { MysqlClientLike } from '@main/drivers/mysql/MysqlDriver'
import type { EngineId } from '@shared/types/connection'

const ctx = () => ({ requestId: 'ro', signal: new AbortController().signal })
const PAGE = { cursor: null, maxRows: 1000, maxBytes: 8_000_000 }

function readOnlySuite(name: string, available: boolean, url: string, engine: EngineId): void {
  describe.skipIf(!available)(`MysqlSqlCapability.beginReadOnly (${name} 실서버)`, () => {
    const u = new URL(url)
    let conn: MysqlClientLike
    let cap: MysqlSqlCapability
    beforeAll(async () => {
      const raw = await mysql.createConnection({
        host: u.hostname,
        port: Number(u.port),
        user: u.username,
        password: decodeURIComponent(u.password),
        database: u.pathname.slice(1),
        dateStrings: true,
        supportBigNumbers: true,
        bigNumberStrings: true,
      })
      conn = raw as unknown as MysqlClientLike
      await raw.query('DROP TABLE IF EXISTS ro_t')
      await raw.query('CREATE TABLE ro_t (id int primary key)')
      await raw.query('INSERT INTO ro_t VALUES (1)')
      cap = new MysqlSqlCapability(() => conn, async () => {}, engine)
    })
    afterAll(async () => {
      await conn.query('DROP TABLE IF EXISTS ro_t')
      await conn.end()
    })

    it('READ ONLY 스코프에서 읽기는 되고 쓰기는 거부, end() 후 쓰기 재허용', async () => {
      const scope = await cap.beginReadOnly(ctx())
      const rs = await scope.execute(ctx(), 'SELECT id FROM ro_t', PAGE)
      expect(rs.rows.length).toBe(1)
      await expect(scope.execute(ctx(), 'INSERT INTO ro_t VALUES (2)', PAGE)).rejects.toThrow()
      await scope.end()
      // end 후 정상 트랜잭션으로 쓰기 가능
      await conn.query('INSERT INTO ro_t VALUES (3)')
      const after = await cap.execute(ctx(), 'SELECT id FROM ro_t ORDER BY id', PAGE)
      expect(after.rows.length).toBe(2)
    })
  })
}

readOnlySuite('MySQL', MYSQL_AVAILABLE, MYSQL_URL, 'mysql')
readOnlySuite('MariaDB', MARIADB_AVAILABLE, MARIADB_URL, 'mariadb')
