import { describe, it, expect } from 'vitest'
import { RedisDriver } from '@main/drivers/redis/RedisDriver'
import { REDIS_AVAILABLE, REDIS_HOST, REDIS_PORT, withDatabase } from '../../../contract/redisTestEnv'
import type { ConnectionConfig } from '@shared/types/connection'
import type { ExecutionContext } from '@main/core/driver/ExecutionContext'
import type { WireValue } from '@shared/types/wire'

const page = { cursor: null, maxRows: 1000, maxBytes: 8 * 1024 * 1024 }

function cfgFor(db: number): ConnectionConfig {
  return {
    id: 'conn-1', name: 't', engine: 'redis',
    host: REDIS_HOST, port: REDIS_PORT, database: String(db), username: '',
    tlsMode: 'disable', aiReadOnlyUsername: null, maskedColumnPatterns: [],
  }
}
const ctx = (): ExecutionContext => ({ requestId: 'r1', signal: new AbortController().signal })
const jsonOf = (cell: WireValue | undefined): unknown =>
  cell !== undefined && cell.t === 'json' ? JSON.parse(cell.v) : undefined

describe.skipIf(!REDIS_AVAILABLE)('RedisKeyValueCapability (실서버)', () => {
  it('scan이 시드된 키를 key/type/ttl 컬럼으로 준다', async () => {
    await withDatabase(
      async (c) => { await c.set('s:1', 'v'); await c.rpush('l:1', 'a', 'b') },
      async (db) => {
        const d = new RedisDriver(cfgFor(db), { getPassword: () => Promise.resolve(null) })
        await d.connect(cfgFor(db))
        try {
          const rs = await d.keyValue.scan(ctx(), {}, page)
          expect(rs.columns.map((c) => c.name)).toEqual(['key', 'type', 'ttl'])
          const keys = rs.rows.map((r) => (r[0]?.t === 'str' ? r[0].v : ''))
          expect(new Set(keys)).toEqual(new Set(['s:1', 'l:1']))
        } finally { await d.disconnect() }
      },
    )
  })

  it('scan MATCH가 패턴에 맞는 키만 준다', async () => {
    await withDatabase(
      async (c) => { await c.set('u:1', 'a'); await c.set('u:2', 'b'); await c.set('x:1', 'c') },
      async (db) => {
        const d = new RedisDriver(cfgFor(db), { getPassword: () => Promise.resolve(null) })
        await d.connect(cfgFor(db))
        try {
          const rs = await d.keyValue.scan(ctx(), { match: 'u:*' }, page)
          const keys = rs.rows.map((r) => (r[0]?.t === 'str' ? r[0].v : '')).sort()
          expect(keys).toEqual(['u:1', 'u:2'])
        } finally { await d.disconnect() }
      },
    )
  })

  it('get이 타입별 값을 정규화 JSON으로 준다', async () => {
    await withDatabase(
      async (c) => {
        await c.set('str', 'hello')
        await c.rpush('list', 'a', 'b')
        await c.sadd('set', 'x')
        await c.hset('hash', 'f', 'v')
        await c.zadd('zset', 1, 'm1', 2, 'm2')
      },
      async (db) => {
        const d = new RedisDriver(cfgFor(db), { getPassword: () => Promise.resolve(null) })
        await d.connect(cfgFor(db))
        try {
          const strRs = await d.keyValue.get(ctx(), 'str', page)
          expect(strRs.columns.map((c) => c.name)).toEqual(['type', 'ttl', 'value'])
          expect(strRs.rows[0]?.[0]).toEqual({ t: 'str', v: 'string' })
          expect(jsonOf(strRs.rows[0]?.[2])).toBe('hello')

          const listRs = await d.keyValue.get(ctx(), 'list', page)
          expect(jsonOf(listRs.rows[0]?.[2])).toEqual(['a', 'b'])

          const setRs = await d.keyValue.get(ctx(), 'set', page)
          expect(jsonOf(setRs.rows[0]?.[2])).toEqual(['x'])

          const hashRs = await d.keyValue.get(ctx(), 'hash', page)
          expect(jsonOf(hashRs.rows[0]?.[2])).toEqual({ f: 'v' })

          const zsetRs = await d.keyValue.get(ctx(), 'zset', page)
          expect(jsonOf(zsetRs.rows[0]?.[2])).toEqual([
            { member: 'm1', score: 1 }, { member: 'm2', score: 2 },
          ])
        } finally { await d.disconnect() }
      },
    )
  })

  it('get: 없는 키는 빈 결과', async () => {
    await withDatabase(
      async () => {},
      async (db) => {
        const d = new RedisDriver(cfgFor(db), { getPassword: () => Promise.resolve(null) })
        await d.connect(cfgFor(db))
        try {
          const rs = await d.keyValue.get(ctx(), 'nope', page)
          expect(rs.rows).toHaveLength(0)
        } finally { await d.disconnect() }
      },
    )
  })

  it('get: ttl은 만료 없는 키에 -1', async () => {
    await withDatabase(
      async (c) => { await c.set('k', 'v') },
      async (db) => {
        const d = new RedisDriver(cfgFor(db), { getPassword: () => Promise.resolve(null) })
        await d.connect(cfgFor(db))
        try {
          const rs = await d.keyValue.get(ctx(), 'k', page)
          expect(rs.rows[0]?.[1]).toEqual({ t: 'int', v: -1 })
        } finally { await d.disconnect() }
      },
    )
  })

  it('취소된 ctx는 scan을 거부한다', async () => {
    await withDatabase(
      async (c) => { await c.set('k', 'v') },
      async (db) => {
        const d = new RedisDriver(cfgFor(db), { getPassword: () => Promise.resolve(null) })
        await d.connect(cfgFor(db))
        try {
          const ac = new AbortController(); ac.abort()
          await expect(
            d.keyValue.scan({ requestId: 'r', signal: ac.signal }, {}, page),
          ).rejects.toThrow()
        } finally { await d.disconnect() }
      },
    )
  })
})
