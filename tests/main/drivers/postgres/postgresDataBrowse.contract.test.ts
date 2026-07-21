import { describe, expect, it } from 'vitest'
import type { ConnectionConfig } from '@shared/types/connection'
import type { ExecutionContext } from '@main/core/driver/ExecutionContext'
import { createPostgresDriver } from '@main/drivers/postgres'
import { DataCapabilityExecutor } from '@main/infrastructure/execution/DataCapabilityExecutor'
import { PG_AVAILABLE, TEST_DB_URL, withSchema } from '../../../contract/pgTestEnv'

function config(): ConnectionConfig {
  const u = new URL(TEST_DB_URL)
  return {
    id: 'pg-data-browse-1', name: 'pg', engine: 'postgres', host: u.hostname, port: Number(u.port),
    database: u.pathname.slice(1), username: decodeURIComponent(u.username),
    tlsMode: 'disable', aiReadOnlyUsername: null, maskedColumnPatterns: [],
  }
}
const PASSWORD = decodeURIComponent(new URL(TEST_DB_URL).password)
function ctx(): ExecutionContext { return { requestId: 'r', signal: new AbortController().signal } }

describe.skipIf(!PG_AVAILABLE)('PostgreSQL data:browse (통합)', () => {
  it('실제 테이블을 정렬해 브라우즈한다', async () => {
    await withSchema(
      'CREATE TABLE t (id int primary key, name text); INSERT INTO t VALUES (2,\'b\'),(1,\'a\'),(3,\'c\');',
      async (schema) => {
        const driver = createPostgresDriver(config(), { getPassword: () => Promise.resolve(PASSWORD) })
        await driver.connect(config())
        try {
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
          // id 오름차순: 1,2,3
          const ids = out.rows.rows.map((r) => r[0])
          expect(ids).toEqual([
            { t: 'int', v: 1 }, { t: 'int', v: 2 }, { t: 'int', v: 3 },
          ])
        } finally {
          await driver.disconnect()
        }
      },
    )
  })
})
