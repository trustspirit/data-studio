import { describe, it, expect } from 'vitest'
import mysql from 'mysql2/promise'
import { MysqlSchemaCapability } from '@main/drivers/mysql/MysqlSchemaCapability'
import { MYSQL_AVAILABLE, MYSQL_URL, withDatabase } from '../../../contract/mysqlTestEnv'
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
})
