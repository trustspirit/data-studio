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

  it('scan은 커서를 따라가며 시드된 키 전체를 순회한다(다중 페이지)', async () => {
    const seeded = Array.from({ length: 50 }, (_, i) => `k:${i}`)
    await withDatabase(
      async (c) => {
        for (const key of seeded) await c.set(key, 'v')
      },
      async (db) => {
        const d = new RedisDriver(cfgFor(db), { getPassword: () => Promise.resolve(null) })
        await d.connect(cfgFor(db))
        try {
          const seen = new Set<string>()
          let cursor: string | null = null
          let batchCount = 0
          // SCAN의 COUNT는 힌트일 뿐이라 배치 수를 미리 알 수 없다 — 버그가 있어도
          // 테스트가 무한 루프에 빠지지 않도록 상한을 둔다.
          const MAX_ITER = 500
          for (let i = 0; i < MAX_ITER; i++) {
            const rs = await d.keyValue.scan(ctx(), {}, { cursor, maxRows: 5, maxBytes: 8 * 1024 * 1024 })
            batchCount++
            for (const row of rs.rows) {
              const key = row[0]
              if (key?.t === 'str') seen.add(key.v)
            }
            cursor = rs.page.cursor
            if (cursor === null) break
          }
          expect(cursor).toBeNull() // 루프가 상한 전에 종료됐다(정상 완주)
          expect(batchCount).toBeGreaterThan(1) // 실제로 여러 배치로 나뉘어 커서 이어읽기가 일어났다
          for (const key of seeded) expect(seen.has(key)).toBe(true)
          expect(seen.size).toBe(seeded.length) // 시드하지 않은 키는 없다
        } finally { await d.disconnect() }
      },
    )
  })

  it('다른 match로 발급된 커서로 이어읽으면 거부한다', async () => {
    await withDatabase(
      async (c) => {
        for (let i = 0; i < 50; i++) await c.set(`a:${i}`, 'v')
      },
      async (db) => {
        const d = new RedisDriver(cfgFor(db), { getPassword: () => Promise.resolve(null) })
        await d.connect(cfgFor(db))
        try {
          // 'a:*' 스캔에서 비-null 커서를 확보할 때까지(또는 이터레이션이 끝날
          // 때까지) 진행한다. COUNT는 힌트일 뿐이라 첫 호출이 곧장 완주할 수도
          // 있으므로, 그런 경우엔 foreign-cursor 단언을 건너뛴다(문서화된 예외).
          let cursor: string | null = null
          let foreignCursor: string | null = null
          for (let i = 0; i < 50 && foreignCursor === null; i++) {
            const rs = await d.keyValue.scan(ctx(), { match: 'a:*' }, { cursor, maxRows: 5, maxBytes: 8 * 1024 * 1024 })
            cursor = rs.page.cursor
            if (cursor !== null) foreignCursor = cursor
            if (cursor === null) break
          }

          if (foreignCursor === null) {
            return // 데이터셋이 작아 한 배치로 완주됨 — 비-null 커서를 얻지 못해 검증 불가
          }

          await expect(
            d.keyValue.scan(
              ctx(),
              { match: 'b:*' },
              { cursor: foreignCursor, maxRows: 5, maxBytes: 8 * 1024 * 1024 },
            ),
          ).rejects.toThrow()
        } finally { await d.disconnect() }
      },
    )
  })

  it('scan은 byte 상한 절단 시 조용히 자르지 않고 에러를 던진다', async () => {
    await withDatabase(
      async (c) => {
        await c.set('t:1', 'v'); await c.set('t:2', 'v'); await c.set('t:3', 'v'); await c.set('t:4', 'v')
      },
      async (db) => {
        const d = new RedisDriver(cfgFor(db), { getPassword: () => Promise.resolve(null) })
        await d.connect(cfgFor(db))
        try {
          await expect(
            d.keyValue.scan(ctx(), {}, { cursor: null, maxRows: 1000, maxBytes: 1 }),
          ).rejects.toThrow(/byte limit/)
        } finally { await d.disconnect() }
      },
    )
  })
})
