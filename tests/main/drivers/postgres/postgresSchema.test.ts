import { describe, expect, it } from 'vitest'
import type { ConnectionConfig } from '@shared/types/connection'
import type { ExecutionContext } from '@main/core/driver/ExecutionContext'
import { createPostgresDriver } from '@main/drivers/postgres'
import { PG_AVAILABLE, TEST_DB_URL, withSchema } from '../../../contract/pgTestEnv'

function config(): ConnectionConfig {
  const u = new URL(TEST_DB_URL)
  return {
    id: 'pg-schema-1', name: 'pg', engine: 'postgres', host: u.hostname, port: Number(u.port),
    database: u.pathname.slice(1), username: decodeURIComponent(u.username),
    tlsMode: 'disable', aiReadOnlyUsername: null, maskedColumnPatterns: [],
  }
}
const PASSWORD = decodeURIComponent(new URL(TEST_DB_URL).password)
function ctx(): ExecutionContext { return { requestId: 'r', signal: new AbortController().signal } }

const SEED = `
  CREATE TABLE parent (a int, b int, PRIMARY KEY (a, b));
  CREATE TABLE child (id int primary key, pa int, pb int,
    CONSTRAINT fk_child FOREIGN KEY (pa, pb) REFERENCES parent (a, b));
  CREATE INDEX child_pa_idx ON child (pa);
  CREATE VIEW v_child AS SELECT id FROM child;
`

describe.skipIf(!PG_AVAILABLE)('PostgresSchemaCapability (실제 pg 필요)', () => {
  it('테이블/뷰 구분, 복합 PK ordinal, 인덱스, FK를 보고한다', async () => {
    await withSchema(SEED, async (schema) => {
      const d = createPostgresDriver(config(), { getPassword: () => Promise.resolve(PASSWORD) })
      await d.connect(config())
      try {
        const s = d.schema
        const tables = await s.listTables(ctx(), schema)
        const byName = Object.fromEntries(tables.map((t) => [t.name, t]))
        expect(byName.parent?.kind).toBe('table')
        expect(byName.v_child?.kind).toBe('view')

        const detail = await s.describeTable(ctx(), schema, 'parent')
        // 복합 PK 순서 보존: a=1, b=2.
        const a = detail.columns.find((c) => c.name === 'a')
        const b = detail.columns.find((c) => c.name === 'b')
        expect(a?.primaryKeyOrdinal).toBe(1)
        expect(b?.primaryKeyOrdinal).toBe(2)

        const indexes = await s.listIndexes(ctx(), schema, 'child')
        expect(indexes.some((i) => i.columns.includes('pa'))).toBe(true)

        const fks = await s.listForeignKeys(ctx(), schema, 'child')
        expect(fks[0]?.referencedTable).toBe('parent')
        expect(fks[0]?.columns).toEqual(['pa', 'pb'])
      } finally {
        await d.disconnect()
      }
    })
  })

  it('listSchemas가 만든 스키마를 포함한다', async () => {
    await withSchema('CREATE TABLE x (id int);', async (schema) => {
      const d = createPostgresDriver(config(), { getPassword: () => Promise.resolve(PASSWORD) })
      await d.connect(config())
      try {
        const schemas = await d.schema.listSchemas(ctx())
        expect(schemas.some((s) => s.name === schema)).toBe(true)
      } finally {
        await d.disconnect()
      }
    })
  })
})
