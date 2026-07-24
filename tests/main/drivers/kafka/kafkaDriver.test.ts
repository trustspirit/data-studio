import { describe, it, expect } from 'vitest'
import { createKafkaDriver } from '@main/drivers/kafka'
import { KafkaConnectionIdentityError, type KafkaClientLike, type KafkaAdminLike, type KafkaConsumerLike } from '@main/drivers/kafka/KafkaDriver'
import type { ConnectionConfig } from '@shared/types/connection'

function cfg(over: Partial<ConnectionConfig> = {}): ConnectionConfig {
  return {
    id: 'conn-1', name: 'test', engine: 'kafka',
    host: 'localhost:9092', port: 9092, database: '', username: '',
    tlsMode: 'disable', aiReadOnlyUsername: null, maskedColumnPatterns: [],
    ...over,
  }
}

function fakeAdmin(): KafkaAdminLike & { connected: number } {
  const a = { connected: 0, connect: () => { a.connected++; return Promise.resolve() }, disconnect: () => Promise.resolve(), listTopics: () => Promise.resolve(['t1']) }
  return a
}
function fakeConsumer(): KafkaConsumerLike {
  return { connect: () => Promise.resolve(), disconnect: () => Promise.resolve(), subscribe: () => Promise.resolve(), run: () => Promise.resolve() }
}
function fakeClient(admin: KafkaAdminLike): KafkaClientLike {
  return { admin: () => admin, consumer: () => fakeConsumer() }
}

describe('KafkaDriver (fake client — 서버 불필요)', () => {
  it('id/engine을 노출한다', () => {
    const d = createKafkaDriver(cfg(), { getPassword: () => Promise.resolve(null), createClient: () => fakeClient(fakeAdmin()) })
    expect(d.id).toBe('conn-1')
    expect(d.engine).toBe('kafka')
  })

  it('stream capability를 노출한다', () => {
    const d = createKafkaDriver(cfg(), { getPassword: () => Promise.resolve(null), createClient: () => fakeClient(fakeAdmin()) })
    expect(d.stream).toBeDefined()
  })

  it('config.id가 어긋나면 connect가 거부된다', async () => {
    const d = createKafkaDriver(cfg(), { getPassword: () => Promise.resolve(null), createClient: () => fakeClient(fakeAdmin()) })
    await expect(d.connect(cfg({ id: 'other' }))).rejects.toThrow(KafkaConnectionIdentityError)
  })

  it('연결 전 disconnect는 안전(멱등)', async () => {
    const d = createKafkaDriver(cfg(), { getPassword: () => Promise.resolve(null), createClient: () => fakeClient(fakeAdmin()) })
    await expect(d.disconnect()).resolves.toBeUndefined()
  })

  it('connect가 admin.connect를 부르고 ping이 유한 ms를 준다', async () => {
    const admin = fakeAdmin()
    const d = createKafkaDriver(cfg(), { getPassword: () => Promise.resolve(null), createClient: () => fakeClient(admin) })
    await d.connect(cfg())
    expect(admin.connected).toBe(1)
    const ms = await d.ping()
    expect(ms).toBeGreaterThanOrEqual(0)
    expect(Number.isFinite(ms)).toBe(true)
  })

  it('연결 전 ping은 거부된다', async () => {
    const d = createKafkaDriver(cfg(), { getPassword: () => Promise.resolve(null), createClient: () => fakeClient(fakeAdmin()) })
    await expect(d.ping()).rejects.toThrow()
  })
})

import { KAFKA_AVAILABLE, KAFKA_BROKERS } from '../../../contract/kafkaTestEnv'

describe.skipIf(!KAFKA_AVAILABLE)('KafkaDriver (실서버)', () => {
  const liveCfg = cfg({ host: KAFKA_BROKERS.join(',') })
  const deps = { getPassword: () => Promise.resolve(null) }

  it('connect 후 ping이 유한한 ms를 준다', async () => {
    const d = createKafkaDriver(liveCfg, deps)
    await d.connect(liveCfg)
    const ms = await d.ping()
    expect(ms).toBeGreaterThanOrEqual(0)
    expect(Number.isFinite(ms)).toBe(true)
    await d.disconnect()
  }, 30000)

  it('disconnect 후 ping은 거부된다', async () => {
    const d = createKafkaDriver(liveCfg, deps)
    await d.connect(liveCfg)
    await d.disconnect()
    await expect(d.ping()).rejects.toThrow()
  }, 30000)

  it('disconnect는 두 번 불러도 안전', async () => {
    const d = createKafkaDriver(liveCfg, deps)
    await d.connect(liveCfg)
    await d.disconnect()
    await expect(d.disconnect()).resolves.toBeUndefined()
  }, 30000)
})
