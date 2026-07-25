import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { Client } from 'pg'
import {
  buildCreateTable,
  validateCreateTable,
} from '../../../../src/renderer/features/structure/model/ddlBuilder'
import { PG_AVAILABLE, TEST_DB_URL, withSchema } from '../../../contract/pgTestEnv'

/**
 * 생성한 DDL을 살아 있는 엔진에 먹인다.
 *
 * 문자열 비교 테스트(ddlBuilder.test.ts)는 "우리가 의도한 모양이 나왔는가"만
 * 본다. 그 모양이 **엔진이 받는 문법인가**는 다른 질문이고, 자동 증가는 절의
 * 위치 하나로 갈리므로 정확히 그 질문을 물어야 한다.
 */
describe('생성된 CREATE TABLE — sqlite 실행', () => {
  it('자동 증가 PK가 실제로 id를 배정한다', () => {
    const sql = buildCreateTable('sqlite', {
      table: 'users',
      columns: [
        { name: 'id', type: 'integer', notNull: false, primaryKey: true, autoIncrement: true },
        { name: 'label', type: 'text', notNull: false, primaryKey: false, autoIncrement: false },
      ],
    })
    const db = new Database(':memory:')
    try {
      db.exec(sql)
      db.exec("INSERT INTO users (label) VALUES ('a'), ('b')")
      const ids = db.prepare('SELECT id FROM users ORDER BY id').all() as { id: unknown }[]
      expect(ids.map((r) => r.id)).toEqual([1, 2])
    } finally {
      db.close()
    }
  })

  it('AUTOINCREMENT는 삭제한 id를 재사용하지 않는다', () => {
    // AUTOINCREMENT를 넣는 이유가 이것이다. 없으면 rowid가 재사용된다.
    const sql = buildCreateTable('sqlite', {
      table: 'users',
      columns: [
        { name: 'id', type: 'integer', notNull: false, primaryKey: true, autoIncrement: true },
        { name: 'label', type: 'text', notNull: false, primaryKey: false, autoIncrement: false },
      ],
    })
    const db = new Database(':memory:')
    try {
      db.exec(sql)
      db.exec("INSERT INTO users (label) VALUES ('a'), ('b')")
      db.exec('DELETE FROM users WHERE id = 2')
      db.exec("INSERT INTO users (label) VALUES ('c')")
      const ids = db.prepare('SELECT id FROM users ORDER BY id').all() as { id: unknown }[]
      expect(ids.map((r) => r.id)).toEqual([1, 3])
    } finally {
      db.close()
    }
  })

  it('자동 증가 없는 테이블도 그대로 실행된다', () => {
    const sql = buildCreateTable('sqlite', {
      table: 't',
      columns: [
        { name: 'a', type: 'integer', notNull: false, primaryKey: true, autoIncrement: false },
        { name: 'b', type: 'text', notNull: true, primaryKey: true, autoIncrement: false },
      ],
    })
    const db = new Database(':memory:')
    try {
      expect(() => db.exec(sql)).not.toThrow()
    } finally {
      db.close()
    }
  })
})

describe('sqlite의 조용한 NULL 함정', () => {
  it('int 타입 + PK만이면 id가 오류 없이 NULL로 들어간다', () => {
    // 이 사실 자체를 적어 둔다. 엔진이 거부하지 않으므로 검증이 조용히
    // 약해지면 아무도 모르고, 사용자는 오류 한 줄 없이 id가 빈 테이블을 얻는다.
    // `integer`가 아니면 rowid 별칭이 아니라는 것이 원인이다.
    const db = new Database(':memory:')
    try {
      db.exec('CREATE TABLE t ("id" int, "l" text, PRIMARY KEY("id"))')
      db.exec("INSERT INTO t (l) VALUES ('a'), ('b')")
      const rows = db.prepare('SELECT id FROM t').all() as { id: unknown }[]
      expect(rows.map((r) => r.id)).toEqual([null, null])
    } finally {
      db.close()
    }
  })

  it('검증이 그 조합을 만들지 못하게 막는다', () => {
    const issues = validateCreateTable('sqlite', {
      table: 't',
      columns: [
        { name: 'id', type: 'int', notNull: false, primaryKey: true, autoIncrement: true },
      ],
    })
    expect(issues.some((issue) => issue.includes('정확히 integer'))).toBe(true)
  })
})

describe.skipIf(!PG_AVAILABLE)('생성된 CREATE TABLE — postgres 실행 (실제 pg 필요)', () => {
  /**
   * 고유 스키마 안에서 SQL을 돌린다.
   *
   * `withSchema`가 uuid 스키마를 만들고 끝나면 지운다. 고정 이름을 쓰면
   * 테스트 파일이 병렬로 돌 때 한쪽의 DROP이 다른 쪽 스키마를 지운다.
   * 그 헬퍼는 스키마 이름만 주고 client는 주지 않으므로 여기서 하나 연다.
   */
  async function inSchema(
    fn: (client: Client, schema: string) => Promise<void>,
  ): Promise<void> {
    await withSchema('', async (schema) => {
      const client = new Client({ connectionString: TEST_DB_URL })
      try {
        // connect()를 try 안에 둔다 — 밖에 두면 connect 실패 시 finally의 end()가
        // 실행되지 않아 client가 정리되지 않는다. connect 실패 후 end()는 문제없이 resolve된다.
        await client.connect()
        await fn(client, schema)
      } finally {
        await client.end()
      }
    })
  }

  it('IDENTITY 절이 통과하고 id를 배정한다', async () => {
    await inSchema(async (c, schema) => {
      await c.query(
        buildCreateTable('postgres', {
          schema,
          table: 'users',
          columns: [
            { name: 'id', type: 'bigint', notNull: false, primaryKey: true, autoIncrement: true },
            { name: 'email', type: 'text', notNull: true, primaryKey: false, autoIncrement: false },
          ],
        }),
      )
      await c.query(`INSERT INTO "${schema}"."users" (email) VALUES ('a@x'), ('b@x')`)
      const r = await c.query(`SELECT id FROM "${schema}"."users" ORDER BY id`)
      // bigint는 pg 드라이버가 문자열로 준다.
      expect(r.rows.map((x: { id: unknown }) => String(x.id))).toEqual(['1', '2'])
    })
  })

  it('IDENTITY 컬럼에 값을 직접 넣는 INSERT도 동작한다', async () => {
    // BY DEFAULT를 고른 이유가 이것이다. ALWAYS면 OVERRIDING 절 없이 거부되고,
    // 데이터 이관·복구가 막힌다.
    await inSchema(async (c, schema) => {
      await c.query(
        buildCreateTable('postgres', {
          schema,
          table: 'users',
          columns: [
            { name: 'id', type: 'bigint', notNull: false, primaryKey: true, autoIncrement: true },
          ],
        }),
      )
      await c.query(`INSERT INTO "${schema}"."users" (id) VALUES (42)`)
      const r = await c.query(`SELECT id FROM "${schema}"."users"`)
      expect(String((r.rows[0] as { id: unknown }).id)).toBe('42')
    })
  })

  it('우리 검증이 막는 조합은 서버도 막는다 — DEFAULT + 자동 증가', async () => {
    // 검증이 서버와 같은 판단을 하는지 확인한다. 검증만 통과시키고 서버가
    // 거부하면 사용자는 미리보기가 옳다고 믿고 실행했다가 실패한다.
    await inSchema(async (c, schema) => {
      const spec = {
        schema,
        table: 'users',
        columns: [
          {
            name: 'id', type: 'bigint', notNull: false, primaryKey: true,
            autoIncrement: true, defaultExpr: '0',
          },
        ],
      }
      expect(validateCreateTable('postgres', spec).length).toBeGreaterThan(0)
      await expect(c.query(buildCreateTable('postgres', spec))).rejects.toThrow(
        /both default and identity/i,
      )
    })
  })
})
