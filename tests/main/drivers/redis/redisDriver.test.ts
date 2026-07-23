import { describe, it, expect } from 'vitest'
import { createRedisDriver } from '@main/drivers/redis'
import { RedisConnectionIdentityError, parseDbIndex, type RedisClientLike, type RedisConnParams } from '@main/drivers/redis/RedisDriver'
import type { ConnectionConfig } from '@shared/types/connection'
import { REDIS_AVAILABLE, REDIS_HOST, REDIS_PORT } from '../../../contract/redisTestEnv'

function cfg(over: Partial<ConnectionConfig> = {}): ConnectionConfig {
  return {
    id: 'conn-1', name: 'test', engine: 'redis',
    host: 'localhost', port: 6379, database: '0', username: '',
    tlsMode: 'disable', aiReadOnlyUsername: null, maskedColumnPatterns: [],
    ...over,
  }
}

function fakeClient(): RedisClientLike & { params: RedisConnParams | null } {
  return {
    params: null,
    connect: () => Promise.resolve(),
    quit: () => Promise.resolve('OK'),
    ping: () => Promise.resolve('PONG'),
    scan: () => Promise.resolve(['0', []]),
    type: () => Promise.resolve('none'),
    pttl: () => Promise.resolve(-2),
    get: () => Promise.resolve(null),
    lrange: () => Promise.resolve([]),
    smembers: () => Promise.resolve([]),
    hgetall: () => Promise.resolve({}),
    zrange: () => Promise.resolve([]),
  }
}

describe('parseDbIndex', () => {
  it('정수 문자열을 파싱한다', () => { expect(parseDbIndex('3')).toBe(3) })
  it('빈/비정수/음수는 0으로', () => {
    expect(parseDbIndex('')).toBe(0)
    expect(parseDbIndex('abc')).toBe(0)
    expect(parseDbIndex('-1')).toBe(0)
  })
})

describe('RedisDriver (fake client — 서버 불필요)', () => {
  it('id/engine을 노출한다', () => {
    const d = createRedisDriver(cfg(), { getPassword: () => Promise.resolve(null), createClient: () => fakeClient() })
    expect(d.id).toBe('conn-1')
    expect(d.engine).toBe('redis')
  })

  it('keyValue capability를 노출한다', () => {
    const d = createRedisDriver(cfg(), { getPassword: () => Promise.resolve(null), createClient: () => fakeClient() })
    expect(d.keyValue).toBeDefined()
  })

  it('config.id가 어긋나면 connect가 거부된다', async () => {
    const d = createRedisDriver(cfg(), { getPassword: () => Promise.resolve(null), createClient: () => fakeClient() })
    await expect(d.connect(cfg({ id: 'other' }))).rejects.toThrow(RedisConnectionIdentityError)
  })

  it('database 문자열을 db 인덱스로 파싱해 넘긴다', async () => {
    const client = fakeClient()
    const d = createRedisDriver(cfg({ database: '5' }), {
      getPassword: () => Promise.resolve(null),
      createClient: (params) => { client.params = params; return client },
    })
    await d.connect(cfg({ database: '5' }))
    expect(client.params?.db).toBe(5)
  })

  it('username 빈 문자열/비밀번호 null을 그대로 전달한다', async () => {
    const client = fakeClient()
    const d = createRedisDriver(cfg(), {
      getPassword: () => Promise.resolve(null),
      createClient: (params) => { client.params = params; return client },
    })
    await d.connect(cfg())
    expect(client.params?.username).toBe('')
    expect(client.params?.password).toBeUndefined()
  })

  it('연결 전 disconnect는 안전(멱등)', async () => {
    const d = createRedisDriver(cfg(), { getPassword: () => Promise.resolve(null), createClient: () => fakeClient() })
    await expect(d.disconnect()).resolves.toBeUndefined()
  })

  it('connect 후 ping이 유한한 ms를 준다', async () => {
    const d = createRedisDriver(cfg(), { getPassword: () => Promise.resolve(null), createClient: () => fakeClient() })
    await d.connect(cfg())
    const ms = await d.ping()
    expect(ms).toBeGreaterThanOrEqual(0)
    expect(Number.isFinite(ms)).toBe(true)
  })
})

describe.skipIf(!REDIS_AVAILABLE)('RedisDriver (실서버)', () => {
  const liveCfg = cfg({ host: REDIS_HOST, port: REDIS_PORT })
  const deps = { getPassword: () => Promise.resolve(null) }

  it('connect 후 ping이 유한한 ms를 준다', async () => {
    const d = createRedisDriver(liveCfg, deps)
    await d.connect(liveCfg)
    const ms = await d.ping()
    expect(ms).toBeGreaterThanOrEqual(0)
    expect(Number.isFinite(ms)).toBe(true)
    await d.disconnect()
  })

  it('disconnect 후 ping은 거부된다', async () => {
    const d = createRedisDriver(liveCfg, deps)
    await d.connect(liveCfg)
    await d.disconnect()
    await expect(d.ping()).rejects.toThrow()
  })

  it('disconnect는 두 번 불러도 안전', async () => {
    const d = createRedisDriver(liveCfg, deps)
    await d.connect(liveCfg)
    await d.disconnect()
    await expect(d.disconnect()).resolves.toBeUndefined()
  })
})
