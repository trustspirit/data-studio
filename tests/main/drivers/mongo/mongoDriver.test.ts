import { describe, it, expect } from 'vitest'
import { createMongoDriver } from '@main/drivers/mongo'
import { MongoConnectionIdentityError } from '@main/drivers/mongo/MongoDriver'
import { MONGO_AVAILABLE, MONGO_URL } from '../../../contract/mongoTestEnv'
import type { ConnectionConfig } from '@shared/types/connection'

function cfg(over: Partial<ConnectionConfig> = {}): ConnectionConfig {
  return {
    id: 'conn-1',
    name: 'test',
    engine: 'mongodb',
    host: MONGO_URL,
    port: 27017,
    database: 'datacon_test',
    username: '',
    tlsMode: 'disable',
    aiReadOnlyUsername: null,
    maskedColumnPatterns: [],
    ...over,
  }
}

describe('MongoDriver (fake client — 서버 불필요)', () => {
  it('id/engine을 노출한다', () => {
    const d = createMongoDriver(cfg(), { getPassword: () => Promise.resolve(null) })
    expect(d.id).toBe('conn-1')
    expect(d.engine).toBe('mongodb')
  })

  it('config.id가 어긋나면 connect가 거부된다', async () => {
    const d = createMongoDriver(cfg(), { getPassword: () => Promise.resolve(null) })
    await expect(d.connect(cfg({ id: 'other' }))).rejects.toThrow(MongoConnectionIdentityError)
  })

  it('연결 전 disconnect는 안전(멱등)', async () => {
    const d = createMongoDriver(cfg(), { getPassword: () => Promise.resolve(null) })
    await expect(d.disconnect()).resolves.toBeUndefined()
  })
})

describe.skipIf(!MONGO_AVAILABLE)('MongoDriver (실서버)', () => {
  const liveCfg = cfg()
  const deps = { getPassword: () => Promise.resolve(null) }

  it('connect 후 ping이 유한한 ms를 준다', async () => {
    const d = createMongoDriver(liveCfg, deps)
    await d.connect(liveCfg)
    const ms = await d.ping()
    expect(ms).toBeGreaterThanOrEqual(0)
    expect(Number.isFinite(ms)).toBe(true)
    await d.disconnect()
  })

  it('disconnect 후 ping은 거부된다', async () => {
    const d = createMongoDriver(liveCfg, deps)
    await d.connect(liveCfg)
    await d.disconnect()
    await expect(d.ping()).rejects.toThrow()
  })

  it('disconnect는 두 번 불러도 안전', async () => {
    const d = createMongoDriver(liveCfg, deps)
    await d.connect(liveCfg)
    await d.disconnect()
    await expect(d.disconnect()).resolves.toBeUndefined()
  })
})
