import { describe, it, expect } from 'vitest'
import { createRabbitDriver } from '@main/drivers/rabbitmq'
import { RabbitConnectionIdentityError, type AmqpConnectionLike, type AmqpChannelLike } from '@main/drivers/rabbitmq/RabbitDriver'
import type { ConnectionConfig } from '@shared/types/connection'

function cfg(over: Partial<ConnectionConfig> = {}): ConnectionConfig {
  return {
    id: 'conn-1', name: 'test', engine: 'rabbitmq',
    host: 'localhost', port: 5672, database: '', username: 'guest',
    tlsMode: 'disable', aiReadOnlyUsername: null, maskedColumnPatterns: [],
    ...over,
  }
}

function fakeChannel(): AmqpChannelLike {
  return {
    assertQueue: () => Promise.resolve({ queue: 'amq.gen-x' }),
    bindQueue: () => Promise.resolve({}),
    consume: () => Promise.resolve({ consumerTag: 'ct' }),
    close: () => Promise.resolve(),
  }
}
function fakeConnection(): AmqpConnectionLike & { created: number; closed: number } {
  const c = {
    created: 0, closed: 0,
    createChannel: () => { c.created++; return Promise.resolve(fakeChannel()) },
    close: () => { c.closed++; return Promise.resolve() },
  }
  return c
}

describe('RabbitDriver (fake — 서버 불필요)', () => {
  it('id/engine을 노출한다', () => {
    const d = createRabbitDriver(cfg(), { getPassword: () => Promise.resolve(null), createConnection: () => Promise.resolve(fakeConnection()) })
    expect(d.id).toBe('conn-1')
    expect(d.engine).toBe('rabbitmq')
  })

  it('stream capability를 노출한다', () => {
    const d = createRabbitDriver(cfg(), { getPassword: () => Promise.resolve(null), createConnection: () => Promise.resolve(fakeConnection()) })
    expect(d.stream).toBeDefined()
  })

  it('config.id가 어긋나면 connect가 거부된다', async () => {
    const d = createRabbitDriver(cfg(), { getPassword: () => Promise.resolve(null), createConnection: () => Promise.resolve(fakeConnection()) })
    await expect(d.connect(cfg({ id: 'other' }))).rejects.toThrow(RabbitConnectionIdentityError)
  })

  it('연결 전 disconnect는 안전(멱등)', async () => {
    const d = createRabbitDriver(cfg(), { getPassword: () => Promise.resolve(null), createConnection: () => Promise.resolve(fakeConnection()) })
    await expect(d.disconnect()).resolves.toBeUndefined()
  })

  it('connect가 createConnection을 부르고 ping이 유한 ms를 준다', async () => {
    const conn = fakeConnection()
    const d = createRabbitDriver(cfg(), { getPassword: () => Promise.resolve(null), createConnection: () => Promise.resolve(conn) })
    await d.connect(cfg())
    const ms = await d.ping() // ping은 채널 assert+close 왕복
    expect(ms).toBeGreaterThanOrEqual(0)
    expect(Number.isFinite(ms)).toBe(true)
    expect(conn.created).toBeGreaterThanOrEqual(1)
  })

  it('연결 전 ping은 거부된다', async () => {
    const d = createRabbitDriver(cfg(), { getPassword: () => Promise.resolve(null), createConnection: () => Promise.resolve(fakeConnection()) })
    await expect(d.ping()).rejects.toThrow()
  })
})

import { RABBIT_AVAILABLE, RABBIT_HOST } from '../../../contract/rabbitTestEnv'

describe.skipIf(!RABBIT_AVAILABLE)('RabbitDriver (실서버)', () => {
  const liveCfg = cfg({ host: RABBIT_HOST })
  const deps = { getPassword: () => Promise.resolve('guest') }

  it('connect 후 ping이 유한한 ms를 준다', async () => {
    const d = createRabbitDriver(liveCfg, deps)
    await d.connect(liveCfg)
    const ms = await d.ping()
    expect(ms).toBeGreaterThanOrEqual(0)
    expect(Number.isFinite(ms)).toBe(true)
    await d.disconnect()
  }, 20000)

  it('disconnect 후 ping은 거부된다', async () => {
    const d = createRabbitDriver(liveCfg, deps)
    await d.connect(liveCfg)
    await d.disconnect()
    await expect(d.ping()).rejects.toThrow()
  }, 20000)

  it('disconnect는 두 번 불러도 안전', async () => {
    const d = createRabbitDriver(liveCfg, deps)
    await d.connect(liveCfg)
    await d.disconnect()
    await expect(d.disconnect()).resolves.toBeUndefined()
  }, 20000)
})
