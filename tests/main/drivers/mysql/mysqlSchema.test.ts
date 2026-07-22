import { describe, it, expect } from 'vitest'
import mysql from 'mysql2/promise'
import { MysqlSchemaCapability } from '@main/drivers/mysql/MysqlSchemaCapability'
import {
  MARIADB_AVAILABLE,
  MARIADB_URL,
  MYSQL_AVAILABLE,
  MYSQL_URL,
  withDatabase,
} from '../../../contract/mysqlTestEnv'
import type { MysqlClientLike } from '@main/drivers/mysql/MysqlDriver'

const ctx = () => ({ requestId: 's', signal: new AbortController().signal })
const SEED = `
  CREATE TABLE parent (id int primary key, name varchar(50) not null);
  CREATE TABLE child (
    a int, b int, note varchar(50) default 'x',
    primary key (a, b),
    constraint fk_child_parent foreign key (a) references parent(id)
  );
  CREATE UNIQUE INDEX ux_parent_name ON parent(name);
  CREATE VIEW v_parent AS SELECT id FROM parent;
`

describe.skipIf(!MYSQL_AVAILABLE)('MysqlSchemaCapability (실서버)', () => {
  it('listTables는 요청 스키마의 table/view만, 없는 스키마는 []', async () => {
    await withDatabase(MYSQL_URL, SEED, async (db) => {
      const raw = await mysql.createConnection(MYSQL_URL)
      const conn = raw as unknown as MysqlClientLike
      const cap = new MysqlSchemaCapability(() => conn)
      const tables = await cap.listTables(ctx(), db)
      const names = tables.map((t) => t.name).sort()
      expect(names).toEqual(['child', 'parent', 'v_parent'])
      expect(tables.find((t) => t.name === 'v_parent')?.kind).toBe('view')
      expect(await cap.listTables(ctx(), 'no_such_db')).toEqual([])
      await raw.end()
    })
  })

  it('describeTable: 복합 PK ordinal 1..n 연속, 없는 스키마 throw', async () => {
    await withDatabase(MYSQL_URL, SEED, async (db) => {
      const raw = await mysql.createConnection(MYSQL_URL)
      const conn = raw as unknown as MysqlClientLike
      const cap = new MysqlSchemaCapability(() => conn)
      const detail = await cap.describeTable(ctx(), db, 'child')
      const pkCols = detail.columns.filter((c) => c.primaryKeyOrdinal !== null)
      expect(pkCols.map((c) => c.primaryKeyOrdinal).sort()).toEqual([1, 2])
      await expect(cap.describeTable(ctx(), 'no_such_db', 'child')).rejects.toThrow()
      await raw.end()
    })
  })

  it('listIndexes unique + listForeignKeys 그룹핑', async () => {
    await withDatabase(MYSQL_URL, SEED, async (db) => {
      const raw = await mysql.createConnection(MYSQL_URL)
      const conn = raw as unknown as MysqlClientLike
      const cap = new MysqlSchemaCapability(() => conn)
      const idx = await cap.listIndexes(ctx(), db, 'parent')
      expect(idx.some((i) => i.name === 'ux_parent_name' && i.unique)).toBe(true)
      const fks = await cap.listForeignKeys(ctx(), db, 'child')
      expect(fks.some((f) => f.referencedTable === 'parent' && f.name === 'fk_child_parent')).toBe(true)
      await raw.end()
    })
  })

  it('listTables: VIEW의 estimatedRows는 0이 아니라 null (TABLE_ROWS NULL 널 가드 검증)', async () => {
    await withDatabase(MYSQL_URL, SEED, async (db) => {
      const raw = await mysql.createConnection(MYSQL_URL)
      const conn = raw as unknown as MysqlClientLike
      const cap = new MysqlSchemaCapability(() => conn)
      const tables = await cap.listTables(ctx(), db)
      const view = tables.find((t) => t.name === 'v_parent')
      expect(view?.kind).toBe('view')
      expect(view?.estimatedRows).toBeNull()
      await raw.end()
    })
  })
})

// MariaDB의 information_schema.KEY_COLUMN_USAGE.ORDINAL_POSITION은 BIGINT로 선언돼
// bigNumberStrings 커넥션에서 문자열로 온다(MySQL 8은 INT라 문자열화되지 않는다) —
// describeTable의 Number(...) 코어션이 실제로 동작하는지 이 경로에서만 제대로 확인된다.
describe.skipIf(!MARIADB_AVAILABLE)('MysqlSchemaCapability primaryKeyOrdinal 타입 (MariaDB 실서버)', () => {
  it('describeTable: PK 컬럼의 primaryKeyOrdinal은 문자열이 아니라 number', async () => {
    await withDatabase(MARIADB_URL, SEED, async (db) => {
      const u = new URL(MARIADB_URL)
      const raw = await mysql.createConnection({
        host: u.hostname,
        port: Number(u.port),
        user: u.username,
        password: decodeURIComponent(u.password),
        database: db,
        dateStrings: true,
        supportBigNumbers: true,
        bigNumberStrings: true,
      })
      const conn = raw as unknown as MysqlClientLike
      const cap = new MysqlSchemaCapability(() => conn)
      const detail = await cap.describeTable(ctx(), db, 'child')
      const pkCols = detail.columns.filter((c) => c.primaryKeyOrdinal !== null)
      expect(pkCols.length).toBeGreaterThan(0)
      for (const c of pkCols) {
        expect(typeof c.primaryKeyOrdinal).toBe('number')
      }
      await raw.end()
    })
  })
})

// MariaDB의 information_schema.STATISTICS.NON_UNIQUE는 BIGINT로 선언돼
// bigNumberStrings 커넥션에서 문자열 "0"/"1"로 온다(MySQL 8은 숫자로 온다) —
// listIndexes의 Number(...) 코어션이 실제로 동작하는지 이 경로에서만 제대로 확인된다.
describe.skipIf(!MARIADB_AVAILABLE)('MysqlSchemaCapability listIndexes unique 타입 (MariaDB 실서버)', () => {
  it('listIndexes: UNIQUE 인덱스의 unique는 true (NON_UNIQUE 문자열 "0" 코어션 검증)', async () => {
    await withDatabase(MARIADB_URL, SEED, async (db) => {
      const u = new URL(MARIADB_URL)
      const raw = await mysql.createConnection({
        host: u.hostname,
        port: Number(u.port),
        user: u.username,
        password: decodeURIComponent(u.password),
        database: db,
        dateStrings: true,
        supportBigNumbers: true,
        bigNumberStrings: true,
      })
      const conn = raw as unknown as MysqlClientLike
      const cap = new MysqlSchemaCapability(() => conn)
      const idx = await cap.listIndexes(ctx(), db, 'parent')
      const ux = idx.find((i) => i.name === 'ux_parent_name')
      expect(ux?.unique).toBe(true)
      const pk = idx.find((i) => i.name === 'PRIMARY')
      expect(pk?.unique).toBe(true)
      await raw.end()
    })
  })
})
