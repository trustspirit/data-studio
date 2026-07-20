import { afterAll, describe, it } from 'vitest'
import type { ConnectionConfig } from '@shared/types/connection'
import { createPostgresDriver } from '@main/drivers/postgres'
import { describeDriverContract } from '../../../contract/driverContract'
import { PG_AVAILABLE, TEST_DB_URL, ensureTestDb } from '../../../contract/pgTestEnv'
import { Client } from 'pg'
import { randomUUID } from 'node:crypto'

function baseConfig(id: string): ConnectionConfig {
  const u = new URL(TEST_DB_URL)
  return {
    id,
    name: 'pg',
    engine: 'postgres',
    host: u.hostname,
    port: Number(u.port),
    database: u.pathname.slice(1),
    username: decodeURIComponent(u.username),
    tlsMode: 'disable',
    aiReadOnlyUsername: null,
    maskedColumnPatterns: [],
  }
}
const PASSWORD = decodeURIComponent(new URL(TEST_DB_URL).password)

if (PG_AVAILABLE) {
  // 계약용 고정 스키마를 미리 만든다(top-level await). 계약 팩토리는 동기라 여기서 시드한다.
  await ensureTestDb()
  const schema = `c_${randomUUID().replace(/-/g, '').slice(0, 12)}`
  const admin = new Client({ connectionString: TEST_DB_URL })
  await admin.connect()
  await admin.query(`CREATE SCHEMA ${schema}`)
  await admin.query(`CREATE TABLE ${schema}.nums (id int primary key)`)
  await admin.query(`INSERT INTO ${schema}.nums SELECT generate_series(1, 5)`)
  await admin.query(`CREATE TABLE ${schema}.other (id int primary key)`)
  await admin.query(`INSERT INTO ${schema}.other VALUES (10),(20),(30)`)
  await admin.query(`CREATE TABLE ${schema}.w (id int primary key)`)
  await admin.query(`INSERT INTO ${schema}.w VALUES (1),(2)`)
  await admin.end()

  describeDriverContract('PostgresDriver', () => ({
    driver: createPostgresDriver(baseConfig('pg-contract-1'), { getPassword: () => Promise.resolve(PASSWORD) }),
    config: baseConfig('pg-contract-1'),
    read: {
      statement: `SELECT id FROM ${schema}.nums ORDER BY id`,
      expectedRowCount: 5,
      foreignStatement: `SELECT id FROM ${schema}.other ORDER BY id`,
    },
    write: { statement: `UPDATE ${schema}.w SET id = id + 100`, expectedRowsAffected: 2 },
    requiresConnection: true,
  }))

  // 계약용으로 만든 고정 스키마는 datacon_test에 영구히 남는다 — 실행할 때마다
  // 새 c_<uuid> 스키마가 쌓이지 않도록 모든 계약 테스트가 끝난 뒤 지운다.
  afterAll(async () => {
    const admin = new Client({ connectionString: TEST_DB_URL })
    await admin.connect()
    try {
      await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
    } finally {
      await admin.end()
    }
  })
} else {
  describe.skip('PostgresDriver 계약 (pg 없음)', () => {
    it('스킵됨', () => {})
  })
}
