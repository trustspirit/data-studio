import { Client } from 'pg'
import { randomUUID } from 'node:crypto'

const ADMIN_URL_RAW = process.env.DATACON_TEST_PG_URL ?? 'postgres://board:boardpw@localhost:5432/board'
export const ADMIN_URL = ADMIN_URL_RAW
const TEST_DB_NAME = 'datacon_test'

/** ADMIN_URL의 데이터베이스만 datacon_test로 바꾼 URL. */
export const TEST_DB_URL = ((): string => {
  const u = new URL(ADMIN_URL_RAW)
  u.pathname = `/${TEST_DB_NAME}`
  return u.toString()
})()

/** 관리 DB에 붙어 datacon_test가 없으면 만든다. */
export async function ensureTestDb(): Promise<void> {
  const admin = new Client({ connectionString: ADMIN_URL })
  await admin.connect()
  try {
    const exists = await admin.query(`SELECT 1 FROM pg_database WHERE datname = $1`, [TEST_DB_NAME])
    if (exists.rowCount === 0) {
      // CREATE DATABASE는 파라미터 바인딩을 못 쓴다 — 이름은 상수라 안전하다.
      await admin.query(`CREATE DATABASE ${TEST_DB_NAME}`)
    }
  } finally {
    await admin.end()
  }
}

async function probe(): Promise<boolean> {
  try {
    await ensureTestDb()
    return true
  } catch {
    return false
  }
}

// 모듈 로드 시 한 번 프로브. pg가 없으면 통합 테스트가 전부 스킵된다.
export const PG_AVAILABLE: boolean = await probe()

/**
 * 고유 스키마를 만들고 seedSql을 그 스키마 안에서 실행한 뒤 fn(schema)를 부른다.
 * 끝나면 스키마를 DROP한다(성공/실패 무관). 병렬 실행 충돌을 피하려 이름에 uuid를 쓴다.
 */
export async function withSchema(
  seedSql: string,
  fn: (schema: string) => Promise<void>,
): Promise<void> {
  const schema = `t_${randomUUID().replace(/-/g, '').slice(0, 12)}`
  const client = new Client({ connectionString: TEST_DB_URL })
  await client.connect()
  try {
    await client.query(`CREATE SCHEMA ${schema}`)
    await client.query(`SET search_path TO ${schema}`)
    if (seedSql.trim() !== '') await client.query(seedSql)
    await fn(schema)
  } finally {
    try {
      await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
    } finally {
      await client.end()
    }
  }
}
