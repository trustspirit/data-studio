import { describe, expect, it } from 'vitest'
import type { ConnectionConfig } from '@shared/types/connection'
import type { ExecutionContext } from '@main/core/driver/ExecutionContext'
import { createPostgresDriver } from '@main/drivers/postgres'
import { PG_AVAILABLE, TEST_DB_URL, withSchema } from '../../../contract/pgTestEnv'

function ctx(resolveColumnOrigins: boolean): ExecutionContext {
  return { requestId: 'r', signal: new AbortController().signal, resolveColumnOrigins }
}

function config(): ConnectionConfig {
  const u = new URL(TEST_DB_URL)
  return {
    id: 'pg-origin-1', name: 'pg', engine: 'postgres', host: u.hostname, port: Number(u.port),
    database: u.pathname.slice(1), username: decodeURIComponent(u.username),
    tlsMode: 'disable', aiReadOnlyUsername: null, maskedColumnPatterns: [],
  }
}
const PASSWORD = decodeURIComponent(new URL(TEST_DB_URL).password)
const PAGE = { cursor: null, maxRows: 1000, maxBytes: 8 * 1024 * 1024 }

const DDL = 'CREATE TABLE t (id int8 primary key, ssn text); INSERT INTO t VALUES (1, \'123-45-6789\');'

/**
 * 이 스위트는 카탈로그 조회 SQL이 **실제 서버에서 돈다**는 것을 검증한다.
 *
 * `resolveOrigins`는 조회 실패를 삼키고 `unresolved`로 떨어지도록 설계됐다(권한이
 * 좁은 AI 읽기 전용 계정에서 실패할 수 있고, 그때 실행 전체를 깨뜨릴 이유는 없다).
 * 그 설계 때문에 SQL에 문법 오류가 있어도 아무도 모르게 기능만 조용히 죽는다.
 * 그러니 라이브 서버로 한 번은 확인해야 한다 — 스텁으로는 이 위험이 잡히지 않는다.
 */
describe.skipIf(!PG_AVAILABLE)('PostgresSqlCapability 컬럼 출처 (실제 pg 필요)', () => {
  it('별칭을 붙여도 원본 컬럼 이름을 보고한다', async () => {
    await withSchema(DDL, async (schema) => {
      const d = createPostgresDriver(config(), { getPassword: () => Promise.resolve(PASSWORD) })
      await d.connect(config())
      try {
        const r = await d.sql.execute(ctx(true), `SELECT ssn AS s, id FROM ${schema}.t`, PAGE)
        expect(r.columns[0]?.name).toBe('s')
        expect(r.columns[0]?.origin).toEqual({ kind: 'column', table: 't', column: 'ssn' })
        expect(r.columns[1]?.origin).toEqual({ kind: 'column', table: 't', column: 'id' })
      } finally {
        await d.disconnect()
      }
    })
  })

  it('식으로 만들어진 컬럼은 computed로 보고한다', async () => {
    await withSchema(DDL, async (schema) => {
      const d = createPostgresDriver(config(), { getPassword: () => Promise.resolve(PASSWORD) })
      await d.connect(config())
      try {
        const r = await d.sql.execute(
          ctx(true),
          `SELECT count(*) AS n, substr(ssn, 1, 4) AS head FROM ${schema}.t GROUP BY ssn`,
          PAGE,
        )
        expect(r.columns[0]?.origin).toEqual({ kind: 'computed' })
        expect(r.columns[1]?.origin).toEqual({ kind: 'computed' })
      } finally {
        await d.disconnect()
      }
    })
  })

  it('요청하지 않으면 출처를 채우지 않는다 (카탈로그 왕복도 없다)', async () => {
    await withSchema(DDL, async (schema) => {
      const d = createPostgresDriver(config(), { getPassword: () => Promise.resolve(PASSWORD) })
      await d.connect(config())
      try {
        const r = await d.sql.execute(ctx(false), `SELECT ssn AS s FROM ${schema}.t`, PAGE)
        expect(r.columns[0]?.origin).toBeUndefined()
      } finally {
        await d.disconnect()
      }
    })
  })

  it('같은 커넥션에서 반복 조회해도 결과가 같다 (캐시가 값을 바꾸지 않는다)', async () => {
    await withSchema(DDL, async (schema) => {
      const d = createPostgresDriver(config(), { getPassword: () => Promise.resolve(PASSWORD) })
      await d.connect(config())
      try {
        const sql = `SELECT ssn AS s FROM ${schema}.t`
        const first = await d.sql.execute(ctx(true), sql, PAGE)
        // 두 번째는 캐시 적중 경로를 탄다 — 카탈로그 조회 없이 같은 답이 나와야 한다.
        const second = await d.sql.execute(ctx(true), sql, PAGE)
        expect(second.columns[0]?.origin).toEqual(first.columns[0]?.origin)
        expect(second.columns[0]?.origin).toEqual({ kind: 'column', table: 't', column: 'ssn' })
      } finally {
        await d.disconnect()
      }
    })
  })
})
