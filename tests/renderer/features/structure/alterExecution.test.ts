import Database from 'better-sqlite3'
import mysql from 'mysql2/promise'
import { Client } from 'pg'
import { describe, expect, it } from 'vitest'
import {
  buildAddColumn,
  buildDropColumn,
  buildDropIndex,
  buildDropTable,
  buildRenameColumn,
  buildRenameTable,
  validateAddColumn,
} from '../../../../src/renderer/features/structure/model/ddlBuilder'
import { PG_AVAILABLE, TEST_DB_URL, withSchema } from '../../../contract/pgTestEnv'
import {
  MARIADB_AVAILABLE,
  MARIADB_URL,
  MYSQL_AVAILABLE,
  MYSQL_URL,
  withDatabase,
} from '../../../contract/mysqlTestEnv'

/**
 * 생성한 ALTER 계열 DDL을 살아 있는 네 엔진에 먹인다.
 *
 * 문자열 비교(alterBuilder.test.ts)는 "의도한 모양이 나왔는가"만 본다.
 * 그 모양이 **엔진이 받는 문법인가**는 다른 질문인데, 여기서 갈리는 것이
 * 실제로 둘 있다: postgres의 RENAME 새 이름 수식 금지, mysql의 DROP INDEX … ON.
 */

describe('생성된 ALTER — sqlite 실행', () => {
  function seeded(): Database.Database {
    const db = new Database(':memory:')
    db.exec(`CREATE TABLE "t" ("id" integer PRIMARY KEY, "name" text, "note" text)`)
    db.exec(`INSERT INTO "t" ("id","name") VALUES (1,'a')`)
    return db
  }

  it('테이블 이름을 바꾼다', () => {
    const db = seeded()
    try {
      db.exec(buildRenameTable('sqlite', { table: 't', newName: 't2' }))
      expect(db.prepare(`SELECT count(*) n FROM "t2"`).get()).toEqual({ n: 1 })
    } finally {
      db.close()
    }
  })

  it('컬럼 이름을 바꾼다', () => {
    const db = seeded()
    try {
      db.exec(buildRenameColumn('sqlite', { table: 't', column: 'name', newName: 'label' }))
      expect(db.prepare(`SELECT "label" FROM "t"`).get()).toEqual({ label: 'a' })
    } finally {
      db.close()
    }
  })

  it('NOT NULL 컬럼 추가가 기존 행에 DEFAULT를 채운다', () => {
    const db = seeded()
    try {
      db.exec(
        buildAddColumn('sqlite', {
          table: 't',
          name: 'status',
          type: 'text',
          notNull: true,
          defaultExpr: "'draft'",
        }),
      )
      expect(db.prepare(`SELECT "status" FROM "t"`).get()).toEqual({ status: 'draft' })
    } finally {
      db.close()
    }
  })

  it('컬럼을 지운다', () => {
    const db = seeded()
    try {
      db.exec(buildDropColumn('sqlite', { table: 't', column: 'note' }))
      expect(() => db.prepare(`SELECT "note" FROM "t"`).get()).toThrow()
    } finally {
      db.close()
    }
  })

  it('인덱스를 이름만으로 지운다', () => {
    const db = seeded()
    try {
      db.exec(`CREATE INDEX "ix_t_name" ON "t" ("name")`)
      db.exec(buildDropIndex('sqlite', { table: 't', indexName: 'ix_t_name' }))
      const left = db.prepare(`SELECT count(*) n FROM sqlite_master WHERE type='index' AND name='ix_t_name'`).get()
      expect(left).toEqual({ n: 0 })
    } finally {
      db.close()
    }
  })

  it('테이블을 지운다', () => {
    const db = seeded()
    try {
      db.exec(buildDropTable('sqlite', { table: 't' }))
      expect(() => db.prepare(`SELECT 1 FROM "t"`).get()).toThrow()
    } finally {
      db.close()
    }
  })

  it('PK·인덱스 컬럼 삭제는 엔진이 거부한다 — 검증이 먼저 막아야 하는 이유', () => {
    const db = seeded()
    try {
      db.exec(`CREATE INDEX "ix_t_name" ON "t" ("name")`)
      expect(() => db.exec(buildDropColumn('sqlite', { table: 't', column: 'id' }))).toThrow(
        /PRIMARY KEY/i,
      )
      expect(() => db.exec(buildDropColumn('sqlite', { table: 't', column: 'name' }))).toThrow(
        /index/i,
      )
    } finally {
      db.close()
    }
  })
})

describe.skipIf(!PG_AVAILABLE)('생성된 ALTER — postgres 실행 (실제 pg 필요)', () => {
  const SEED = `CREATE TABLE "t" ("id" bigint PRIMARY KEY, "name" text, "note" text);
    INSERT INTO "t" VALUES (1,'a','n')`

  async function inSchema(fn: (c: Client, schema: string) => Promise<void>): Promise<void> {
    await withSchema(SEED, async (schema) => {
      const client = new Client({ connectionString: TEST_DB_URL })
      try {
        await client.connect()
        await client.query(`SET search_path TO ${schema}`)
        await fn(client, schema)
      } finally {
        await client.end()
      }
    })
  }

  it('스키마를 한정한 테이블의 이름 변경이 통과한다', async () => {
    // 이 테스트가 잡는 것: 새 이름을 스키마로 한정하면 pg는 syntax error를 낸다.
    await inSchema(async (c, schema) => {
      const sql = buildRenameTable('postgres', { schema, table: 't', newName: 't2' })
      await c.query(sql)
      const r = await c.query(`SELECT count(*)::int n FROM ${schema}."t2"`)
      expect(r.rows[0]).toEqual({ n: 1 })
    })
  })

  it('컬럼 이름을 바꾼다', async () => {
    await inSchema(async (c, schema) => {
      await c.query(buildRenameColumn('postgres', { schema, table: 't', column: 'name', newName: 'label' }))
      const r = await c.query(`SELECT "label" FROM ${schema}."t"`)
      expect(r.rows[0]).toEqual({ label: 'a' })
    })
  })

  it('NOT NULL 컬럼 추가가 기존 행에 DEFAULT를 채운다', async () => {
    await inSchema(async (c, schema) => {
      await c.query(
        buildAddColumn('postgres', {
          schema,
          table: 't',
          name: 'status',
          type: 'text',
          notNull: true,
          defaultExpr: `'draft'`,
        }),
      )
      const r = await c.query(`SELECT "status" FROM ${schema}."t"`)
      expect(r.rows[0]).toEqual({ status: 'draft' })
    })
  })

  it('컬럼을 지우면 그 컬럼의 인덱스도 함께 사라진다', async () => {
    // pg는 이것을 조용히 한다 — 확인 문구에서 알려야 하는 근거.
    await inSchema(async (c, schema) => {
      await c.query(`CREATE INDEX "ix_t_note" ON ${schema}."t" ("note")`)
      await c.query(buildDropColumn('postgres', { schema, table: 't', column: 'note' }))
      const r = await c.query(
        `SELECT count(*)::int n FROM pg_indexes WHERE schemaname=$1 AND indexname='ix_t_note'`,
        [schema],
      )
      expect(r.rows[0]).toEqual({ n: 0 })
    })
  })

  it('인덱스를 스키마 한정 이름으로 지운다', async () => {
    await inSchema(async (c, schema) => {
      await c.query(`CREATE INDEX "ix_t_name" ON ${schema}."t" ("name")`)
      await c.query(buildDropIndex('postgres', { schema, table: 't', indexName: 'ix_t_name' }))
      const r = await c.query(
        `SELECT count(*)::int n FROM pg_indexes WHERE schemaname=$1 AND indexname='ix_t_name'`,
        [schema],
      )
      expect(r.rows[0]).toEqual({ n: 0 })
    })
  })

  it('테이블을 지운다', async () => {
    await inSchema(async (c, schema) => {
      await c.query(buildDropTable('postgres', { schema, table: 't' }))
      await expect(c.query(`SELECT 1 FROM ${schema}."t"`)).rejects.toThrow()
    })
  })
})

// mysql과 mariadb는 문법이 같아 같은 본문을 돌린다.
const MY_ENGINES = [
  { id: 'mysql' as const, url: MYSQL_URL, available: MYSQL_AVAILABLE },
  { id: 'mariadb' as const, url: MARIADB_URL, available: MARIADB_AVAILABLE },
]

for (const engine of MY_ENGINES) {
  describe.skipIf(!engine.available)(`생성된 ALTER — ${engine.id} 실행 (실제 서버 필요)`, () => {
    const SEED = `CREATE TABLE \`t\` (\`id\` bigint PRIMARY KEY, \`name\` varchar(50), \`note\` varchar(50));
      INSERT INTO \`t\` VALUES (1,'a','n')`

    async function inDb(fn: (c: mysql.Connection, db: string) => Promise<void>): Promise<void> {
      await withDatabase(engine.url, SEED, async (dbName) => {
        const c = await mysql.createConnection(engine.url)
        try {
          await c.changeUser({ database: dbName })
          await fn(c, dbName)
        } finally {
          await c.end()
        }
      })
    }

    it('테이블·컬럼 이름을 바꾼다', async () => {
      await inDb(async (c) => {
        await c.query(buildRenameTable(engine.id, { table: 't', newName: 't2' }))
        await c.query(buildRenameColumn(engine.id, { table: 't2', column: 'name', newName: 'label' }))
        const [rows] = await c.query('SELECT `label` FROM `t2`')
        expect((rows as { label: string }[])[0]?.label).toBe('a')
      })
    })

    it('NOT NULL 컬럼 추가가 기존 행에 DEFAULT를 채운다', async () => {
      await inDb(async (c) => {
        await c.query(
          buildAddColumn(engine.id, {
            table: 't',
            name: 'status',
            type: 'varchar(20)',
            notNull: true,
            defaultExpr: `'draft'`,
          }),
        )
        const [rows] = await c.query('SELECT `status` FROM `t`')
        expect((rows as { status: string }[])[0]?.status).toBe('draft')
      })
    })

    it('DEFAULT 없는 NOT NULL 추가는 엔진이 막지 않고 빈 값을 채운다 — 검증만이 방어선이다', async () => {
      // 이 엔진의 함정. sqlite·postgres는 거부하지만 여기서는 성공하면서
      // 기존 행이 ''로 채워진다. 그래서 validateAddColumn이 DEFAULT를 요구한다.
      await inDb(async (c) => {
        const spec = { table: 't', name: 'req', type: 'varchar(20)', notNull: true } as const
        expect(validateAddColumn(engine.id, spec).join(' ')).toContain('DEFAULT')
        await c.query(buildAddColumn(engine.id, spec))
        const [rows] = await c.query('SELECT `req` FROM `t`')
        expect((rows as { req: string }[])[0]?.req).toBe('')
      })
    })

    it('인덱스 삭제는 ON <테이블>이 있어야 하고, 표준형은 구문 오류다', async () => {
      await inDb(async (c) => {
        await c.query('CREATE INDEX `ix_t_name` ON `t` (`name`)')
        // 우리가 내는 형태
        await c.query(buildDropIndex(engine.id, { table: 't', indexName: 'ix_t_name' }))
        const [rows] = await c.query('SHOW INDEX FROM `t` WHERE Key_name = ?', ['ix_t_name'])
        expect(rows as unknown[]).toHaveLength(0)
        // 표준형이 실제로 거부되는지 — 방언 분기가 없으면 여기서 깨진다
        await c.query('CREATE INDEX `ix2` ON `t` (`note`)')
        await expect(c.query('DROP INDEX `ix2`')).rejects.toThrow()
      })
    })

    it('컬럼과 테이블을 지운다', async () => {
      await inDb(async (c) => {
        await c.query(buildDropColumn(engine.id, { table: 't', column: 'note' }))
        await expect(c.query('SELECT `note` FROM `t`')).rejects.toThrow()
        await c.query(buildDropTable(engine.id, { table: 't' }))
        await expect(c.query('SELECT 1 FROM `t`')).rejects.toThrow()
      })
    })
  })
}
