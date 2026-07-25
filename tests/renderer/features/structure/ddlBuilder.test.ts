import { describe, expect, it } from 'vitest'
import {
  buildAddForeignKey,
  buildCreateIndex,
  buildCreateTable,
  quoteIdent,
  supportsAddForeignKey,
  TYPE_SUGGESTIONS,
  validateCreateTable,
  validateForeignKey,
  validateIndex,
} from '../../../../src/renderer/features/structure/model/ddlBuilder'
import { SQL_ENGINE_IDS } from '../../../../src/shared/types/connection'

describe('quoteIdent', () => {
  it('postgres/sqlite는 큰따옴표, mysql/mariadb는 백틱', () => {
    expect(quoteIdent('postgres', 'users')).toBe('"users"')
    expect(quoteIdent('sqlite', 'users')).toBe('"users"')
    expect(quoteIdent('mysql', 'users')).toBe('`users`')
    expect(quoteIdent('mariadb', 'users')).toBe('`users`')
  })

  it('내부 인용 문자를 두 번 적어 식별자 경계 탈출을 막는다', () => {
    expect(quoteIdent('postgres', 'we"ird')).toBe('"we""ird"')
    expect(quoteIdent('mysql', 'we`ird')).toBe('`we``ird`')
    // 교차 인용 문자는 그대로 둔다 — 해당 방언에서 특수문자가 아니다.
    expect(quoteIdent('postgres', 'back`tick')).toBe('"back`tick"')
  })
})

describe('buildCreateTable', () => {
  it('컬럼·NOT NULL·DEFAULT·복합 PK를 담은 CREATE TABLE을 만든다', () => {
    const sql = buildCreateTable('postgres', {
      schema: 'public',
      table: 'orders',
      columns: [
        { name: 'id', type: 'bigserial', notNull: true, primaryKey: true },
        { name: 'tenant', type: 'text', notNull: true, primaryKey: true },
        { name: 'status', type: 'text', notNull: false, primaryKey: false, defaultExpr: "'draft'" },
      ],
    })
    expect(sql).toBe(
      'CREATE TABLE "public"."orders" (\n' +
        '  "id" bigserial NOT NULL,\n' +
        '  "tenant" text NOT NULL,\n' +
        '  "status" text DEFAULT \'draft\',\n' +
        '  PRIMARY KEY ("id", "tenant")\n' +
        ')',
    )
  })

  it('PK 컬럼이 없으면 PRIMARY KEY 절을 생략한다', () => {
    const sql = buildCreateTable('sqlite', {
      table: 'logs',
      columns: [{ name: 'line', type: 'text', notNull: false, primaryKey: false }],
    })
    expect(sql).toBe('CREATE TABLE "logs" (\n  "line" text\n)')
  })

  it('스키마가 비면 테이블명만 한정한다', () => {
    const sql = buildCreateTable('mysql', {
      schema: '',
      table: 'items',
      columns: [{ name: 'id', type: 'bigint', notNull: true, primaryKey: true }],
    })
    expect(sql).toBe('CREATE TABLE `items` (\n  `id` bigint NOT NULL,\n  PRIMARY KEY (`id`)\n)')
  })

  it('빈 defaultExpr는 DEFAULT 절을 만들지 않는다', () => {
    const sql = buildCreateTable('postgres', {
      table: 't',
      columns: [{ name: 'a', type: 'text', notNull: false, primaryKey: false, defaultExpr: '  ' }],
    })
    expect(sql).not.toContain('DEFAULT')
  })
})

describe('buildAddForeignKey', () => {
  it('제약 이름·ON DELETE를 담은 ALTER TABLE을 만든다', () => {
    const sql = buildAddForeignKey('postgres', {
      schema: 'public',
      table: 'orders',
      constraintName: 'fk_orders_user',
      columns: ['user_id'],
      refSchema: 'public',
      refTable: 'users',
      refColumns: ['id'],
      onDelete: 'CASCADE',
    })
    expect(sql).toBe(
      'ALTER TABLE "public"."orders"\n' +
        '  ADD CONSTRAINT "fk_orders_user" FOREIGN KEY ("user_id")\n' +
        '  REFERENCES "public"."users" ("id")\n' +
        '  ON DELETE CASCADE',
    )
  })

  it('제약 이름이 비면 CONSTRAINT 절을, NO ACTION이면 ON DELETE 절을 생략한다', () => {
    const sql = buildAddForeignKey('mysql', {
      table: 'orders',
      columns: ['user_id'],
      refTable: 'users',
      refColumns: ['id'],
      onDelete: 'NO ACTION',
    })
    expect(sql).toBe(
      'ALTER TABLE `orders`\n  ADD FOREIGN KEY (`user_id`)\n  REFERENCES `users` (`id`)',
    )
  })

  it('sqlite는 지원하지 않는다 — capability 함수와 빌더가 함께 막는다', () => {
    expect(supportsAddForeignKey('sqlite')).toBe(false)
    expect(supportsAddForeignKey('postgres')).toBe(true)
    expect(() =>
      buildAddForeignKey('sqlite', { table: 't', columns: ['a'], refTable: 'r', refColumns: ['b'] }),
    ).toThrow(/sqlite/)
  })
})

describe('buildCreateIndex', () => {
  it('UNIQUE·복합 컬럼 인덱스를 만들고 인덱스명은 한정하지 않는다', () => {
    const sql = buildCreateIndex('postgres', {
      schema: 'public',
      table: 'orders',
      indexName: 'idx_orders_user',
      columns: ['user_id', 'created_at'],
      unique: true,
    })
    expect(sql).toBe(
      'CREATE UNIQUE INDEX "idx_orders_user" ON "public"."orders" ("user_id", "created_at")',
    )
  })

  it('unique=false면 UNIQUE를 생략한다', () => {
    const sql = buildCreateIndex('mariadb', {
      table: 't',
      indexName: 'i',
      columns: ['c'],
      unique: false,
    })
    expect(sql).toBe('CREATE INDEX `i` ON `t` (`c`)')
  })
})

describe('TYPE_SUGGESTIONS', () => {
  it('모든 SQL 엔진에 비어 있지 않은 제안 목록이 있다', () => {
    for (const id of SQL_ENGINE_IDS) expect(TYPE_SUGGESTIONS[id].length).toBeGreaterThan(0)
  })
})

describe('validate*', () => {
  it('validateCreateTable — 빈 이름·빈 컬럼·중복 이름을 잡는다', () => {
    expect(validateCreateTable({ table: '', columns: [] }).length).toBeGreaterThanOrEqual(2)
    expect(
      validateCreateTable({
        table: 't',
        columns: [
          { name: 'a', type: 'text', notNull: false, primaryKey: false },
          { name: 'a', type: 'int', notNull: false, primaryKey: false },
        ],
      }),
    ).toContain('컬럼 이름이 중복되었습니다.')
    expect(
      validateCreateTable({
        table: 't',
        columns: [{ name: 'a', type: 'text', notNull: false, primaryKey: false }],
      }),
    ).toEqual([])
  })

  it('validateForeignKey — 컬럼 수 불일치를 잡는다', () => {
    expect(
      validateForeignKey({ table: 't', columns: ['a', 'b'], refTable: 'r', refColumns: ['x'] }),
    ).toContain('원본 컬럼 수와 참조 컬럼 수가 다릅니다.')
    expect(
      validateForeignKey({ table: 't', columns: ['a'], refTable: 'r', refColumns: ['x'] }),
    ).toEqual([])
  })

  it('validateIndex — 빈 이름·빈 컬럼을 잡는다', () => {
    expect(validateIndex({ table: 't', indexName: '', columns: [], unique: false }).length).toBe(2)
    expect(validateIndex({ table: 't', indexName: 'i', columns: ['c'], unique: false })).toEqual([])
  })
})
