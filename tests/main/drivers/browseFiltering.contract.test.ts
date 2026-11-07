import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { Client } from 'pg'
import mysql from 'mysql2/promise'
import { PostgresDataCapability } from '@main/drivers/postgres/PostgresDataCapability'
import { MysqlDataCapability } from '@main/drivers/mysql/MysqlDataCapability'
import { SqliteDataCapability } from '@main/drivers/sqlite/SqliteDataCapability'
import type { BrowseFilter } from '@shared/types/operation'
import { PG_AVAILABLE, TEST_DB_URL, withSchema } from '../../contract/pgTestEnv'
import { MYSQL_AVAILABLE, MARIADB_AVAILABLE, MYSQL_URL, MARIADB_URL, withDatabase } from '../../contract/mysqlTestEnv'

const seed = "CREATE TABLE filter_rows (id integer primary key, label varchar(100)); INSERT INTO filter_rows VALUES (1, 'literal_%'), (2, 'other'), (3, NULL)"
const filters: readonly BrowseFilter[] = [{ column: 'label', operator: 'contains', value: '_%' }]
const unused = (): never => { throw new Error('building SQL does not require a connection') }

describe('server-side filtering contracts', () => {
  it('SQLite binds filters and treats wildcards literally', () => {
    const database = new Database(':memory:')
    try {
      database.exec(seed)
      const built = new SqliteDataCapability(unused).buildBrowse('main', 'filter_rows', undefined, filters)
      expect(database.prepare(built.sql).all(...built.params)).toEqual([{ id: 1, label: 'literal_%' }])
    } finally { database.close() }
  })
  it.runIf(PG_AVAILABLE)('PostgreSQL binds filters and treats wildcards literally', async () => {
    await withSchema(seed, async (schema) => {
      const client = new Client({ connectionString: TEST_DB_URL })
      await client.connect()
      try {
        const built = new PostgresDataCapability(unused).buildBrowse(schema, 'filter_rows', undefined, filters)
        expect((await client.query(built.sql, [...built.params])).rows).toEqual([{ id: 1, label: 'literal_%' }])
      } finally { await client.end() }
    })
  })
  for (const engine of [{ name: 'MySQL', url: MYSQL_URL, available: MYSQL_AVAILABLE }, { name: 'MariaDB', url: MARIADB_URL, available: MARIADB_AVAILABLE }]) {
    it.runIf(engine.available)(`${engine.name} binds filters and treats wildcards literally`, async () => {
      await withDatabase(engine.url, seed, async (schema) => {
        const client = await mysql.createConnection(engine.url)
        try {
          const built = new MysqlDataCapability(unused).buildBrowse(schema, 'filter_rows', undefined, filters)
          const [rows] = await client.query(built.sql, [...built.params])
          expect(rows).toEqual([{ id: 1, label: 'literal_%' }])
        } finally { await client.end() }
      })
    })
  }
})
