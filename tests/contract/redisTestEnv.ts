import Redis from 'ioredis'

export const REDIS_HOST = process.env.DATACON_TEST_REDIS_HOST ?? 'localhost'
export const REDIS_PORT = Number(process.env.DATACON_TEST_REDIS_PORT ?? '6379')

async function probe(): Promise<boolean> {
  const client = new Redis({ host: REDIS_HOST, port: REDIS_PORT, lazyConnect: true, maxRetriesPerRequest: 1 })
  try {
    await client.connect()
    await client.ping()
    return true
  } catch {
    return false
  } finally {
    client.disconnect()
  }
}

// 모듈 로드 시 한 번 프로브. redis가 없으면 통합 테스트가 전부 스킵된다.
export const REDIS_AVAILABLE: boolean = await probe()

/**
 * 사용 안 하는 DB 인덱스를 골라 seedFn(client)로 키를 시드한 뒤 fn(db)을 부른다.
 * 끝나면 FLUSHDB(성공/실패 무관). 병렬 워커 충돌을 피하려 랜덤 인덱스(1-15)를 쓴다.
 * (mongoTestEnv의 uuid DB에 대응 — redis는 0-15 인덱스로 격리.)
 */
export async function withDatabase(
  seedFn: (client: Redis) => Promise<void>,
  fn: (db: number) => Promise<void>,
): Promise<void> {
  // 0은 기본 DB라 피하고 1-15 중 하나. requestId 없이 결정적이지 않아도 되지만,
  // 테스트 격리를 위해 FLUSHDB로 시작·종료를 감싼다.
  const db = 1 + Math.floor(Math.random() * 15)
  const client = new Redis({ host: REDIS_HOST, port: REDIS_PORT, db, lazyConnect: true })
  await client.connect()
  try {
    await client.flushdb()
    await seedFn(client)
    await fn(db)
  } finally {
    try {
      await client.flushdb()
    } finally {
      client.disconnect()
    }
  }
}
