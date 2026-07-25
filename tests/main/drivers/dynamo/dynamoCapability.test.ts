import { describe, it, expect } from 'vitest'
import type { ConnectionConfig } from '@shared/types/connection'
import { createDynamoDriver } from '@main/drivers/dynamo'
import { DynamoCapabilityExecutor } from '@main/infrastructure/execution/DynamoCapabilityExecutor'
import { DYNAMO_AVAILABLE, DYNAMO_HOST, withTable } from '../../../contract/dynamoTestEnv'

const d = DYNAMO_AVAILABLE ? describe : describe.skip

function cfg(): ConnectionConfig {
  return {
    id: 'live', name: 'n', engine: 'dynamodb', host: DYNAMO_HOST, port: 8000,
    database: 'us-east-1', username: 'fake', tlsMode: 'disable',
    aiReadOnlyUsername: null, maskedColumnPatterns: [],
  }
}
const ctx = { requestId: 'r', signal: new AbortController().signal }
const page = { cursor: null, maxRows: 100, maxBytes: 8 * 1024 * 1024 }

function itemValue(rs: { rows: readonly (readonly { t: string; v?: unknown }[])[] }): unknown[] {
  return rs.rows.map((row) => JSON.parse(String(row[0]?.v)))
}

d('DynamoCapability (live)', () => {
  it('ping은 유한 ms, disconnect 후 거부', async () => {
    const drv = createDynamoDriver(cfg(), { getPassword: async () => 'fake' })
    await drv.connect(cfg())
    expect(await drv.ping()).toBeGreaterThanOrEqual(0)
    await drv.disconnect()
    await expect(drv.ping()).rejects.toThrow(/not connected/)
  })

  it('listTables가 생성한 테이블을 포함한다', async () => {
    await withTable([], async (table) => {
      const drv = createDynamoDriver(cfg(), { getPassword: async () => 'fake' })
      await drv.connect(cfg())
      try {
        const rs = await drv.dynamo.listTables(ctx, page)
        const names = rs.rows.map((r) => (r[0]?.t === 'str' ? r[0].v : ''))
        expect(names).toContain(table)
      } finally {
        await drv.disconnect()
      }
    })
  })

  it('scan이 아이템을 _item으로 전부 돌려준다', async () => {
    await withTable([{ pk: 'a', n: 1 }, { pk: 'b', n: 2 }], async (table) => {
      const drv = createDynamoDriver(cfg(), { getPassword: async () => 'fake' })
      await drv.connect(cfg())
      try {
        const rs = await drv.dynamo.scan(ctx, { table }, page)
        const pks = itemValue(rs).map((it) => (it as { pk: string }).pk).sort()
        expect(pks).toEqual(['a', 'b'])
      } finally {
        await drv.disconnect()
      }
    })
  })

  it('PartiQL SELECT가 WHERE로 파티션 키 조회를 한다', async () => {
    await withTable([{ pk: 'a', n: 1 }, { pk: 'b', n: 2 }], async (table) => {
      const drv = createDynamoDriver(cfg(), { getPassword: async () => 'fake' })
      await drv.connect(cfg())
      try {
        const rs = await drv.dynamo.partiql(ctx, { statement: `SELECT * FROM "${table}" WHERE pk = 'a'` }, page)
        const items = itemValue(rs)
        expect(items).toHaveLength(1)
        expect((items[0] as { pk: string }).pk).toBe('a')
      } finally {
        await drv.disconnect()
      }
    })
  })

  it('executor 관문이 비-SELECT PartiQL을 던진다(드라이버 도달 전)', async () => {
    await withTable([{ pk: 'a' }], async (table) => {
      const drv = createDynamoDriver(cfg(), { getPassword: async () => 'fake' })
      await drv.connect(cfg())
      try {
        const ex = new DynamoCapabilityExecutor()
        await expect(
          ex.execute({
            ctx, driver: drv, operation: { kind: 'dynamo', op: 'partiql', statement: `DELETE FROM "${table}" WHERE pk = 'a'` },
            page, limits: { timeoutMs: 1000, maxRows: 100, maxBytes: 1000 }, readOnlyScope: false, connectionId: 'live',
          }),
        ).rejects.toThrow(/read-only/)
      } finally {
        await drv.disconnect()
      }
    })
  })
})
