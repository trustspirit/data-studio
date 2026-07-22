import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { SqliteSchemaCapability } from '@main/drivers/sqlite/SqliteSchemaCapability'
import type { DatabaseInstance } from '@main/drivers/sqlite/SqliteDriver'
import type { ExecutionContext } from '@main/core/driver/ExecutionContext'

let dir: string
let db: DatabaseInstance
function ctx(): ExecutionContext {
  return { requestId: 'r', signal: new AbortController().signal }
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'datacon-sqlite-schema-'))
  db = new Database(join(dir, 'schema.db'))
  db.exec(`
    CREATE TABLE users (id integer primary key, name text not null, email text);
    CREATE UNIQUE INDEX users_email_idx ON users(email);
    CREATE TABLE orders (id integer primary key, user_id integer, note text,
      FOREIGN KEY (user_id) REFERENCES users(id));
  `)
})
afterAll(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})
function cap(): SqliteSchemaCapability {
  return new SqliteSchemaCapability(() => db)
}

describe('SqliteSchemaCapability', () => {
  it('listSchemas가 main을 포함한다', async () => {
    const schemas = await cap().listSchemas(ctx())
    expect(schemas.map((s) => s.name)).toContain('main')
  })

  it('listTables가 사용자 테이블만(내부 sqlite_% 제외) 준다', async () => {
    const tables = await cap().listTables(ctx(), 'main')
    const names = tables.map((t) => t.name).sort()
    expect(names).toEqual(['orders', 'users'])
    for (const t of tables) {
      expect(t.schema).toBe('main')
      expect(t.kind).toBe('table')
    }
  })

  it('없는 스키마의 listTables는 빈 배열', async () => {
    expect(await cap().listTables(ctx(), 'nope')).toEqual([])
  })

  it('describeTable이 컬럼과 PK ordinal을 준다', async () => {
    const detail = await cap().describeTable(ctx(), 'main', 'users')
    expect(detail.name).toBe('users')
    const id = detail.columns.find((c) => c.name === 'id')
    const name = detail.columns.find((c) => c.name === 'name')
    expect(id?.primaryKeyOrdinal).toBe(1)
    expect(name?.primaryKeyOrdinal).toBeNull()
    expect(name?.nullable).toBe(false)
    expect(structuredClone(detail)).toEqual(detail)
  })

  it('없는 스키마의 describeTable은 거부', async () => {
    await expect(cap().describeTable(ctx(), 'nope', 'users')).rejects.toThrow()
  })

  it('listIndexes가 유니크 인덱스를 준다', async () => {
    const indexes = await cap().listIndexes(ctx(), 'main', 'users')
    const emailIdx = indexes.find((i) => i.columns.includes('email'))
    expect(emailIdx?.unique).toBe(true)
  })

  it('listForeignKeys가 FK를 이름과 함께 준다', async () => {
    const fks = await cap().listForeignKeys(ctx(), 'main', 'orders')
    expect(fks).toHaveLength(1)
    expect(fks[0]?.name.length).toBeGreaterThan(0)
    expect(fks[0]?.columns).toEqual(['user_id'])
    expect(fks[0]?.referencedTable).toBe('users')
    expect(fks[0]?.referencedColumns).toEqual(['id'])
  })
})
