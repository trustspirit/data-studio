import { describe, expect, it } from 'vitest'
import type { ConnectionConfig } from '@shared/types/connection'
import type { ExecutionContext } from '@main/core/driver/ExecutionContext'
import { createPostgresDriver } from '@main/drivers/postgres'
import { DataCapabilityExecutor } from '@main/infrastructure/execution/DataCapabilityExecutor'
import { PG_AVAILABLE, TEST_DB_URL, withSchema } from '../../../contract/pgTestEnv'

function config(): ConnectionConfig {
  const u = new URL(TEST_DB_URL)
  return {
    id: 'pg-data-apply-1', name: 'pg', engine: 'postgres', host: u.hostname, port: Number(u.port),
    database: u.pathname.slice(1), username: decodeURIComponent(u.username),
    tlsMode: 'disable', aiReadOnlyUsername: null, maskedColumnPatterns: [],
  }
}
const PASSWORD = decodeURIComponent(new URL(TEST_DB_URL).password)
function ctx(): ExecutionContext { return { requestId: 'r', signal: new AbortController().signal } }

async function browseAll(
  driver: ReturnType<typeof createPostgresDriver>,
  schema: string,
): Promise<unknown> {
  const out = await new DataCapabilityExecutor().execute({
    ctx: ctx(),
    driver,
    operation: { kind: 'data', op: 'browse', schema, table: 't', sort: { column: 'id', direction: 'asc' } },
    page: { cursor: null, maxRows: 100, maxBytes: 1_000_000 },
    limits: { timeoutMs: 5000, maxRows: 100, maxBytes: 1_000_000 },
    readOnlyScope: false,
  })
  expect(out.kind).toBe('rows')
  if (out.kind !== 'rows') throw new Error('expected rows')
  return out.rows.rows
}

describe.skipIf(!PG_AVAILABLE)('PostgreSQL data:apply (통합)', () => {
  it('insert+update+delete를 원자적으로 적용한다', async () => {
    await withSchema(
      'CREATE TABLE t (id int primary key, name text); INSERT INTO t VALUES (1,\'a\'),(2,\'b\');',
      async (schema) => {
        const driver = createPostgresDriver(config(), { getPassword: () => Promise.resolve(PASSWORD) })
        await driver.connect(config())
        try {
          const data = driver.data
          if (data === undefined) throw new Error('driver does not support data')
          const result = await data.applyChanges(ctx(), schema, 't', [
            { op: 'update', pk: { id: { t: 'int', v: 1 } }, set: { name: { t: 'str', v: 'A' } } },
            { op: 'delete', pk: { id: { t: 'int', v: 2 } } },
            { op: 'insert', values: { id: { t: 'int', v: 3 }, name: { t: 'str', v: 'c' } } },
          ])
          expect(result.affected).toBe(3)

          const rows = await browseAll(driver, schema)
          expect(rows).toEqual([
            [{ t: 'int', v: 1 }, { t: 'str', v: 'A' }],
            [{ t: 'int', v: 3 }, { t: 'str', v: 'c' }],
          ])
        } finally {
          await driver.disconnect()
        }
      },
    )
  })

  it('한 문장이 제약을 위반하면 전체를 롤백한다', async () => {
    await withSchema(
      'CREATE TABLE t (id int primary key, name text not null); INSERT INTO t VALUES (1,\'a\');',
      async (schema) => {
        const driver = createPostgresDriver(config(), { getPassword: () => Promise.resolve(PASSWORD) })
        await driver.connect(config())
        try {
          const data = driver.data
          if (data === undefined) throw new Error('driver does not support data')
          await expect(
            data.applyChanges(ctx(), schema, 't', [
              { op: 'update', pk: { id: { t: 'int', v: 1 } }, set: { name: { t: 'str', v: 'A' } } },
              { op: 'insert', values: { id: { t: 'int', v: 2 }, name: { t: 'null' } } },
            ]),
          ).rejects.toThrow()

          const rows = await browseAll(driver, schema)
          expect(rows).toEqual([
            [{ t: 'int', v: 1 }, { t: 'str', v: 'a' }],
          ])
        } finally {
          await driver.disconnect()
        }
      },
    )
  })
})
