import { describe, expect, it } from 'vitest'
import type { Db } from 'mongodb'
import { ObjectId, Decimal128 } from 'mongodb'
import { createMongoDriver } from '@main/drivers/mongo'
import { MongoDocumentCapability } from '@main/drivers/mongo/MongoDocumentCapability'
import { parseEjson } from '@main/drivers/mongo/mongoEjson'
import { MONGO_AVAILABLE, MONGO_URL, withDatabase } from '../../../contract/mongoTestEnv'
import type { ConnectionConfig } from '@shared/types/connection'
import type { ExecutionContext } from '@main/core/driver/ExecutionContext'
import type { PageRequest } from '@shared/types/resultSet'

function cfg(dbName: string): ConnectionConfig {
  return {
    id: 'conn-1',
    name: 'test',
    engine: 'mongodb',
    host: MONGO_URL,
    port: 27017,
    database: dbName,
    username: '',
    tlsMode: 'disable',
    aiReadOnlyUsername: null,
    maskedColumnPatterns: [],
  }
}

function ctx(requestId = 'r'): ExecutionContext {
  return { requestId, signal: new AbortController().signal }
}
function abortedCtx(): ExecutionContext {
  const c = new AbortController()
  c.abort()
  return { requestId: 'r', signal: c.signal }
}
const FULL: PageRequest = { cursor: null, maxRows: 1000, maxBytes: 8_000_000 }

function docColumn(row: readonly unknown[]): unknown {
  const cell = row[0] as { t: string; v: string }
  expect(cell.t).toBe('json')
  return parseEjson(cell.v)
}

describe.skipIf(!MONGO_AVAILABLE)('MongoDocumentCapability (실서버)', () => {
  it('listCollections가 시드된 컬렉션 이름들을 돌려준다', async () => {
    await withDatabase(
      async (db) => {
        await db.collection('a').insertOne({ x: 1 })
        await db.collection('b').insertOne({ x: 1 })
      },
      async (dbName) => {
        const driver = createMongoDriver(cfg(dbName), { getPassword: () => Promise.resolve(null) })
        await driver.connect(cfg(dbName))
        try {
          const r = await driver.document.listCollections(ctx(), FULL)
          const names = r.rows.map((row) => (row[0] as { v: string }).v).sort()
          expect(names).toEqual(['a', 'b'])
          expect(r.columns).toEqual([{ name: 'name', type: 'str' }])
        } finally {
          await driver.disconnect()
        }
      },
    )
  })

  it('find가 필터/정렬/limit을 적용하고 문서를 EJSON _doc 컬럼에 담는다', async () => {
    await withDatabase(
      async (db: Db) => {
        await db.collection('items').insertMany([
          { kind: 'x', n: 3 },
          { kind: 'x', n: 1 },
          { kind: 'x', n: 2 },
          { kind: 'y', n: 9 },
        ])
      },
      async (dbName) => {
        const driver = createMongoDriver(cfg(dbName), { getPassword: () => Promise.resolve(null) })
        await driver.connect(cfg(dbName))
        try {
          const r = await driver.document.find(
            ctx(),
            { collection: 'items', filter: '{"kind":"x"}', sort: '{"n":1}', limit: 2 },
            FULL,
          )
          expect(r.columns).toEqual([{ name: '_doc', type: 'json' }])
          expect(r.rows).toHaveLength(2)
          const docs = r.rows.map((row) => docColumn(row) as { n: number })
          expect(docs.map((d) => d.n)).toEqual([1, 2])
        } finally {
          await driver.disconnect()
        }
      },
    )
  })

  it('find는 한 행씩 오프셋 커서로 이어 읽어도 전체 읽기와 같은 결과를 준다', async () => {
    await withDatabase(
      async (db: Db) => {
        await db.collection('nums').insertMany([{ n: 1 }, { n: 2 }, { n: 3 }])
      },
      async (dbName) => {
        const driver = createMongoDriver(cfg(dbName), { getPassword: () => Promise.resolve(null) })
        await driver.connect(cfg(dbName))
        try {
          const req = { collection: 'nums', sort: '{"n":1}' }
          const full = await driver.document.find(ctx(), req, FULL)
          const collected: unknown[] = []
          let cursor: string | null = null
          for (let i = 0; i < 10; i++) {
            const page = await driver.document.find(ctx(), req, { cursor, maxRows: 1, maxBytes: FULL.maxBytes })
            collected.push(...page.rows)
            cursor = page.page.cursor
            if (cursor === null) break
          }
          expect(collected).toEqual(full.rows)
        } finally {
          await driver.disconnect()
        }
      },
    )
  })

  it('발급하지 않은/다른 질의의 커서를 거부한다', async () => {
    await withDatabase(
      async (db: Db) => {
        await db.collection('nums').insertMany([{ n: 1 }, { n: 2 }])
        await db.collection('other').insertMany([{ n: 1 }, { n: 2 }])
      },
      async (dbName) => {
        const driver = createMongoDriver(cfg(dbName), { getPassword: () => Promise.resolve(null) })
        await driver.connect(cfg(dbName))
        try {
          await expect(
            driver.document.find(ctx(), { collection: 'nums' }, { cursor: 'garbage', maxRows: 1, maxBytes: FULL.maxBytes }),
          ).rejects.toThrow()

          const first = await driver.document.find(ctx(), { collection: 'nums', sort: '{"n":1}' }, {
            cursor: null,
            maxRows: 1,
            maxBytes: FULL.maxBytes,
          })
          const cursor = first.page.cursor as string
          await expect(
            driver.document.find(ctx(), { collection: 'other', sort: '{"n":1}' }, {
              cursor,
              maxRows: 1,
              maxBytes: FULL.maxBytes,
            }),
          ).rejects.toThrow()
        } finally {
          await driver.disconnect()
        }
      },
    )
  })

  it('aggregate가 정상 파이프라인을 실행하고 결과를 EJSON으로 담는다', async () => {
    await withDatabase(
      async (db: Db) => {
        await db.collection('orders').insertMany([
          { region: 'a', amount: 10 },
          { region: 'a', amount: 5 },
          { region: 'b', amount: 1 },
        ])
      },
      async (dbName) => {
        const driver = createMongoDriver(cfg(dbName), { getPassword: () => Promise.resolve(null) })
        await driver.connect(cfg(dbName))
        try {
          const pipeline = JSON.stringify([
            { $match: { region: 'a' } },
            { $group: { _id: '$region', total: { $sum: '$amount' } } },
          ])
          const r = await driver.document.aggregate(ctx(), { collection: 'orders', pipeline }, FULL)
          expect(r.rows).toHaveLength(1)
          const doc = docColumn(r.rows[0] as readonly unknown[]) as { total: number }
          expect(doc.total).toBe(15)
        } finally {
          await driver.disconnect()
        }
      },
    )
  })

  it('isReadOnlyPipeline은 $out/$merge 스테이지가 있으면 false, 정상 파이프라인엔 true', () => {
    const cap = new MongoDocumentCapability(() => {
      throw new Error('getDb should not be called by isReadOnlyPipeline')
    })
    expect(cap.isReadOnlyPipeline(JSON.stringify([{ $match: {} }, { $group: { _id: '$k' } }]))).toBe(true)
    expect(cap.isReadOnlyPipeline(JSON.stringify([{ $match: {} }, { $out: 'copy' }]))).toBe(false)
    expect(cap.isReadOnlyPipeline(JSON.stringify([{ $match: {} }, { $merge: { into: 'copy' } }]))).toBe(false)
  })

  it('driver.document.aggregate는 $out/$merge 파이프라인을 방어적으로 거부한다', async () => {
    await withDatabase(
      async (db: Db) => {
        await db.collection('orders').insertOne({ region: 'a', amount: 10 })
      },
      async (dbName) => {
        const driver = createMongoDriver(cfg(dbName), { getPassword: () => Promise.resolve(null) })
        await driver.connect(cfg(dbName))
        try {
          const outPipeline = JSON.stringify([{ $match: {} }, { $out: 'copy' }])
          await expect(driver.document.aggregate(ctx(), { collection: 'orders', pipeline: outPipeline }, FULL)).rejects.toThrow()

          const mergePipeline = JSON.stringify([{ $match: {} }, { $merge: { into: 'copy' } }])
          await expect(
            driver.document.aggregate(ctx(), { collection: 'orders', pipeline: mergePipeline }, FULL),
          ).rejects.toThrow()

          // copy 컬렉션이 실제로 생기지 않았어야 한다(방어가 실제로 실행을 막았는지 확인).
          const names = (await driver.document.listCollections(ctx(), FULL)).rows.map((row) => (row[0] as { v: string }).v)
          expect(names).not.toContain('copy')
        } finally {
          await driver.disconnect()
        }
      },
    )
  })

  it('EJSON 왕복이 ObjectId/Decimal128/Date를 무손실로 보존한다', async () => {
    await withDatabase(
      async (db: Db) => {
        await db.collection('typed').insertOne({
          oid: new ObjectId('507f1f77bcf86cd799439011'),
          amount: Decimal128.fromString('42.5'),
          when: new Date('2022-03-04T05:06:07.000Z'),
        })
      },
      async (dbName) => {
        const driver = createMongoDriver(cfg(dbName), { getPassword: () => Promise.resolve(null) })
        await driver.connect(cfg(dbName))
        try {
          const r = await driver.document.find(ctx(), { collection: 'typed' }, FULL)
          const doc = docColumn(r.rows[0] as readonly unknown[]) as {
            oid: ObjectId
            amount: Decimal128
            when: Date
          }
          expect(doc.oid).toBeInstanceOf(ObjectId)
          expect(doc.oid.toHexString()).toBe('507f1f77bcf86cd799439011')
          expect(doc.amount).toBeInstanceOf(Decimal128)
          expect(doc.amount.toString()).toBe('42.5')
          expect(doc.when).toBeInstanceOf(Date)
          expect(doc.when.toISOString()).toBe('2022-03-04T05:06:07.000Z')
        } finally {
          await driver.disconnect()
        }
      },
    )
  })

  it('이미 취소된 컨텍스트는 find/aggregate/listCollections를 거부한다', async () => {
    await withDatabase(
      async (db: Db) => {
        await db.collection('nums').insertOne({ n: 1 })
      },
      async (dbName) => {
        const driver = createMongoDriver(cfg(dbName), { getPassword: () => Promise.resolve(null) })
        await driver.connect(cfg(dbName))
        try {
          await expect(driver.document.listCollections(abortedCtx(), FULL)).rejects.toThrow()
          await expect(driver.document.find(abortedCtx(), { collection: 'nums' }, FULL)).rejects.toThrow()
          await expect(
            driver.document.aggregate(abortedCtx(), { collection: 'nums', pipeline: '[]' }, FULL),
          ).rejects.toThrow()
        } finally {
          await driver.disconnect()
        }
      },
    )
  })
})
