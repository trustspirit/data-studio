import { MongoClient, type Db } from 'mongodb'
import { randomUUID } from 'node:crypto'

export const MONGO_URL = process.env.DATACON_TEST_MONGO_URL ?? 'mongodb://localhost:27017'

async function probe(): Promise<boolean> {
  const client = new MongoClient(MONGO_URL, { serverSelectionTimeoutMS: 1000 })
  try {
    await client.connect()
    await client.db().command({ ping: 1 })
    return true
  } catch {
    return false
  } finally {
    await client.close()
  }
}

// 모듈 로드 시 한 번 프로브. mongo가 없으면 통합 테스트가 전부 스킵된다.
export const MONGO_AVAILABLE: boolean = await probe()

/**
 * uuid 이름의 데이터베이스를 만들고 seedFn(db)로 컬렉션/문서를 시드한 뒤
 * fn(dbName)을 부른다. 끝나면 dropDatabase(성공/실패 무관). 병렬 워커 충돌을
 * 피하려 이름에 uuid를 쓴다.
 */
export async function withDatabase(
  seedFn: (db: Db) => Promise<void>,
  fn: (dbName: string) => Promise<void>,
): Promise<void> {
  const dbName = `t_${randomUUID().replace(/-/g, '').slice(0, 12)}`
  const client = new MongoClient(MONGO_URL)
  await client.connect()
  try {
    const db = client.db(dbName)
    await seedFn(db)
    await fn(dbName)
  } finally {
    try {
      await client.db(dbName).dropDatabase()
    } finally {
      await client.close()
    }
  }
}
