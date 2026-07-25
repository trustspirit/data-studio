import { describe, it, expect, vi } from 'vitest'
import type { ConnectionConfig } from '@shared/types/connection'
import { createDynamoDriver, DynamoConnectionIdentityError, type DynamoClientLike } from '@main/drivers/dynamo'

function cfg(over: Partial<ConnectionConfig> = {}): ConnectionConfig {
  return {
    id: 'c1', name: 'n', engine: 'dynamodb', host: 'localhost', port: 8000,
    database: 'us-east-1', username: 'x', tlsMode: 'disable',
    aiReadOnlyUsername: null, maskedColumnPatterns: [], ...over,
  }
}

function fakeClient(over: Partial<DynamoClientLike> = {}): DynamoClientLike {
  return {
    listTables: vi.fn(() => Promise.resolve({ TableNames: ['t1'] })),
    scan: vi.fn(() => Promise.resolve({ Items: [] })),
    executeStatement: vi.fn(() => Promise.resolve({ Items: [] })),
    destroy: vi.fn(),
    ...over,
  }
}

describe('DynamoDriver', () => {
  it('id/engine을 노출한다', () => {
    const d = createDynamoDriver(cfg(), { getPassword: () => Promise.resolve(null) })
    expect(d.id).toBe('c1')
    expect(d.engine).toBe('dynamodb')
    expect(d.dynamo).toBeDefined()
  })

  it('config.id가 다르면 던진다', async () => {
    const d = createDynamoDriver(cfg(), { getPassword: () => Promise.resolve(null) })
    await expect(d.connect(cfg({ id: 'other' }))).rejects.toBeInstanceOf(DynamoConnectionIdentityError)
  })

  it('연결 전 disconnect는 안전하다(멱등)', async () => {
    const d = createDynamoDriver(cfg(), { getPassword: () => Promise.resolve(null) })
    await expect(d.disconnect()).resolves.toBeUndefined()
    await expect(d.disconnect()).resolves.toBeUndefined()
  })

  it('connect는 createClient를 부르고 ping은 listTables 왕복(유한 ms)', async () => {
    const listTables = vi.fn(() => Promise.resolve({ TableNames: ['t1'] }))
    const client = fakeClient({ listTables })
    const create = vi.fn(() => client)
    const d = createDynamoDriver(cfg(), { getPassword: () => Promise.resolve('secret'), createClient: create })
    await d.connect(cfg())
    expect(create).toHaveBeenCalledOnce()
    const ms = await d.ping()
    expect(ms).toBeGreaterThanOrEqual(0)
    expect(listTables).toHaveBeenCalledWith({ Limit: 1 })
  })

  it('disconnect는 client.destroy를 부르고 이후 ping은 거부한다', async () => {
    const destroy = vi.fn()
    const client = fakeClient({ destroy })
    const d = createDynamoDriver(cfg(), { getPassword: () => Promise.resolve(null), createClient: () => client })
    await d.connect(cfg())
    await d.disconnect()
    expect(destroy).toHaveBeenCalledOnce()
    await expect(d.ping()).rejects.toThrow(/not connected/)
  })
})
