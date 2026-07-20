import { describe, expect, it } from 'vitest'
import { Client } from 'pg'
import { PG_AVAILABLE, TEST_DB_URL, withSchema } from './pgTestEnv'

describe.skipIf(!PG_AVAILABLE)('pgTestEnv (실제 pg 필요)', () => {
  it('고유 스키마를 만들고 seed를 실행한 뒤 정리한다', async () => {
    let seenSchema = ''
    await withSchema('CREATE TABLE nums (id int primary key); INSERT INTO nums VALUES (1),(2);', async (schema) => {
      seenSchema = schema
      const client = new Client({ connectionString: TEST_DB_URL })
      await client.connect()
      try {
        const r = await client.query<{ c: number }>(`SELECT count(*)::int AS c FROM ${schema}.nums`)
        expect(r.rows[0]?.c).toBe(2)
      } finally {
        await client.end()
      }
    })

    // 스키마가 정리됐는지 확인 — 남아 있으면 정리 누락.
    const client = new Client({ connectionString: TEST_DB_URL })
    await client.connect()
    try {
      const r = await client.query<{ c: number }>(
        `SELECT count(*)::int AS c FROM information_schema.schemata WHERE schema_name = $1`,
        [seenSchema],
      )
      expect(r.rows[0]?.c).toBe(0)
    } finally {
      await client.end()
    }
  })
})

describe('pgTestEnv 스킵 안전', () => {
  it('PG_AVAILABLE은 boolean이다', () => {
    // pg가 없으면 false여야 하고, 그 경우 위 describe가 통째로 스킵된다.
    expect(typeof PG_AVAILABLE).toBe('boolean')
  })
})
