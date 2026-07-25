import { describe, expect, it } from 'vitest'
import {
  buildAddColumn,
  buildDropColumn,
  buildDropIndex,
  buildDropTable,
  buildRenameColumn,
  buildRenameTable,
  validateAddColumn,
  validateDropColumn,
  validateDropIndex,
  validateDropTable,
  validateRenameColumn,
  validateRenameTable,
  type TableFacts,
} from '../../../../src/renderer/features/structure/model/ddlBuilder'
import { SQL_ENGINE_IDS } from '../../../../src/shared/types/connection'

// 규칙의 근거는 전부 실측이다 — docs/superpowers/specs/2026-07-26-alter-ddl-measurements.md.

describe('buildRenameTable', () => {
  it('네 방언 모두 ALTER TABLE … RENAME TO를 낸다', () => {
    expect(buildRenameTable('sqlite', { table: 't', newName: 't2' })).toBe(
      'ALTER TABLE "t" RENAME TO "t2"',
    )
    expect(buildRenameTable('mysql', { table: 't', newName: 't2' })).toBe(
      'ALTER TABLE `t` RENAME TO `t2`',
    )
  })

  it('postgres는 새 이름을 스키마로 한정하지 않는다', () => {
    // 실측: `ALTER TABLE s."t" RENAME TO s."t2"`는 syntax error다. RENAME은
    // 스키마를 옮기지 못하므로 새 이름은 반드시 비수식이어야 한다.
    const sql = buildRenameTable('postgres', { schema: 'app', table: 't', newName: 't2' })
    expect(sql).toBe('ALTER TABLE "app"."t" RENAME TO "t2"')
    expect(sql).not.toContain('"app"."t2"')
  })

  it('새 이름의 앞뒤 공백은 버린다 — 실수로 남은 공백이 다른 이름을 만들면 안 된다', () => {
    // 엔진은 `"  t2  "`를 받지만, 빈 칸에 타이핑하는 사용자가 의도하는 이름은 아니다.
    expect(buildRenameTable('postgres', { table: 't', newName: '  t2  ' })).toBe(
      'ALTER TABLE "t" RENAME TO "t2"',
    )
    expect(buildRenameColumn('postgres', { table: 't', column: 'a', newName: ' b ' })).toBe(
      'ALTER TABLE "t" RENAME COLUMN "a" TO "b"',
    )
  })

  it('기존 이름의 공백은 건드리지 않는다 — 그건 실제 식별자다', () => {
    // 대상 이름은 카탈로그에서 읽어 온 값이므로 그대로 써야 한다.
    expect(buildRenameColumn('postgres', { table: ' t ', column: ' a ', newName: 'b' })).toBe(
      'ALTER TABLE " t " RENAME COLUMN " a " TO "b"',
    )
  })

  it('새 이름에 스키마 구분자가 섞여 들어와도 식별자 하나로 인용한다', () => {
    // 사용자가 "app.t2"를 치면 새 스키마로 옮기는 것이 아니라 그 이름의 테이블이 된다.
    // 인용 밖으로 새어 두 부분 이름이 되는 쪽이 훨씬 나쁘다.
    expect(buildRenameTable('postgres', { table: 't', newName: 'app.t2' })).toBe(
      'ALTER TABLE "t" RENAME TO "app.t2"',
    )
  })
})

describe('buildRenameColumn', () => {
  it('네 방언 모두 같은 형태다', () => {
    for (const d of SQL_ENGINE_IDS) {
      const sql = buildRenameColumn(d, { schema: 's', table: 't', column: 'a', newName: 'b' })
      expect(sql).toContain('RENAME COLUMN')
      expect(sql).toMatch(/RENAME COLUMN [`"]a[`"] TO [`"]b[`"]$/)
    }
  })
})

describe('buildAddColumn', () => {
  it('타입·DEFAULT·NOT NULL을 CREATE TABLE과 같은 순서로 낸다', () => {
    expect(
      buildAddColumn('postgres', {
        schema: 'app',
        table: 't',
        name: 'status',
        type: 'text',
        notNull: true,
        defaultExpr: "'draft'",
      }),
    ).toBe(`ALTER TABLE "app"."t" ADD COLUMN "status" text DEFAULT 'draft' NOT NULL`)
  })

  it('DEFAULT가 없으면 절을 생략한다', () => {
    expect(
      buildAddColumn('sqlite', { table: 't', name: 'note', type: 'text', notNull: false }),
    ).toBe('ALTER TABLE "t" ADD COLUMN "note" text')
  })
})

describe('buildDropColumn / buildDropTable', () => {
  it('평범한 형태다', () => {
    expect(buildDropColumn('mysql', { schema: 'app', table: 't', column: 'c' })).toBe(
      'ALTER TABLE `app`.`t` DROP COLUMN `c`',
    )
    expect(buildDropTable('postgres', { schema: 'app', table: 't' })).toBe(
      'DROP TABLE "app"."t"',
    )
  })

  it('DROP TABLE에 CASCADE를 붙이지 않는다', () => {
    // 다른 객체를 조용히 지우는 버튼은 두지 않는다. FK가 걸려 있으면 엔진이
    // 거부하고, 그 원문이 그대로 화면에 뜬다.
    expect(buildDropTable('postgres', { schema: 'app', table: 't' })).not.toContain('CASCADE')
  })
})

describe('buildDropIndex', () => {
  it('mysql 계열은 ON <테이블>이 필요하다', () => {
    // 실측: mysql·mariadb에서 `DROP INDEX ix`만 쓰면 구문 오류다.
    expect(buildDropIndex('mysql', { schema: 'app', table: 't', indexName: 'ix' })).toBe(
      'DROP INDEX `ix` ON `app`.`t`',
    )
    expect(buildDropIndex('mariadb', { table: 't', indexName: 'ix' })).toBe(
      'DROP INDEX `ix` ON `t`',
    )
  })

  it('sqlite는 인덱스 이름만 쓴다', () => {
    expect(buildDropIndex('sqlite', { table: 't', indexName: 'ix' })).toBe('DROP INDEX "ix"')
  })

  it('postgres는 인덱스 이름을 스키마로 한정하고 테이블은 쓰지 않는다', () => {
    // pg에서 인덱스는 스키마에 귀속된 객체다.
    expect(buildDropIndex('postgres', { schema: 'app', table: 't', indexName: 'ix' })).toBe(
      'DROP INDEX "app"."ix"',
    )
  })
})

describe('validateRenameTable / validateRenameColumn', () => {
  it('빈 이름과 같은 이름을 막는다', () => {
    expect(validateRenameTable({ table: 't', newName: '  ' })).toContain('새 테이블 이름을 입력하세요.')
    expect(validateRenameTable({ table: 't', newName: 't' })).toContain('이름이 기존과 같습니다.')
    expect(validateRenameTable({ table: 't', newName: 't2' })).toEqual([])
  })

  it('컬럼 이름 변경도 같은 규칙이다', () => {
    expect(validateRenameColumn({ table: 't', column: '', newName: 'b' })).toContain(
      '바꿀 컬럼을 고르세요.',
    )
    expect(validateRenameColumn({ table: 't', column: 'a', newName: 'a' })).toContain(
      '이름이 기존과 같습니다.',
    )
    expect(validateRenameColumn({ table: 't', column: 'a', newName: 'b' })).toEqual([])
  })
})

describe('validateAddColumn — NOT NULL이면 DEFAULT를 요구한다', () => {
  const base = { table: 't', name: 'c', type: 'text' } as const

  it('네 방언 모두에서 DEFAULT 없는 NOT NULL을 막는다', () => {
    // 실측: mysql·mariadb는 오류를 내지 않고 기존 행에 ''·0을 조용히 채운다.
    // sqlite·postgres는 거부한다. 넷을 같은 결과로 맞추고, 채울 값을
    // 사용자가 직접 고르게 한다.
    for (const d of SQL_ENGINE_IDS) {
      const issues = validateAddColumn(d, { ...base, notNull: true })
      expect(issues.join(' ')).toContain('DEFAULT')
    }
  })

  it('DEFAULT를 주면 통과한다', () => {
    expect(validateAddColumn('mysql', { ...base, notNull: true, defaultExpr: "''" })).toEqual([])
  })

  it('nullable이면 DEFAULT 없이도 통과한다', () => {
    expect(validateAddColumn('mysql', { ...base, notNull: false })).toEqual([])
  })

  it('공백뿐인 DEFAULT는 없는 것으로 본다', () => {
    expect(validateAddColumn('mysql', { ...base, notNull: true, defaultExpr: '   ' }).length)
      .toBeGreaterThan(0)
  })

  it('이름과 타입이 비면 막는다', () => {
    expect(validateAddColumn('sqlite', { table: 't', name: '', type: 'text', notNull: false }))
      .toContain('컬럼 이름을 입력하세요.')
    expect(validateAddColumn('sqlite', { table: 't', name: 'c', type: ' ', notNull: false }))
      .toContain('컬럼 타입을 입력하세요.')
  })
})

describe('validateDropColumn — sqlite만 제약이 강하다', () => {
  const facts: TableFacts = { pkColumns: ['id'], indexedColumns: ['email'] }

  it('sqlite는 PK 컬럼 삭제를 막는다', () => {
    // 실측: `cannot drop PRIMARY KEY column: "id"`
    expect(validateDropColumn('sqlite', { table: 't', column: 'id' }, facts).join(' '))
      .toContain('PK')
  })

  it('sqlite는 인덱스가 걸린 컬럼 삭제를 막는다', () => {
    // 실측: `error in index ix_u_e after drop column`
    expect(validateDropColumn('sqlite', { table: 't', column: 'email' }, facts).join(' '))
      .toContain('인덱스')
  })

  it('sqlite도 평범한 컬럼은 통과한다', () => {
    expect(validateDropColumn('sqlite', { table: 't', column: 'note' }, facts)).toEqual([])
  })

  it('다른 엔진은 PK·인덱스 컬럼도 허용한다', () => {
    // 실측: postgres·mysql·mariadb는 둘 다 성공한다. 엔진이 받아 주는 것을
    // UI가 막으면 사용자는 왜 안 되는지 알 방법이 없다.
    for (const d of ['postgres', 'mysql', 'mariadb'] as const) {
      expect(validateDropColumn(d, { table: 't', column: 'id' }, facts)).toEqual([])
      expect(validateDropColumn(d, { table: 't', column: 'email' }, facts)).toEqual([])
    }
  })

  it('대상 컬럼이 비면 막는다', () => {
    expect(validateDropColumn('postgres', { table: 't', column: '' }, facts))
      .toContain('삭제할 컬럼을 고르세요.')
  })
})

describe('validateDropTable / validateDropIndex', () => {
  it('대상이 비면 막는다', () => {
    expect(validateDropTable({ table: '' })).toContain('테이블을 고르세요.')
    expect(validateDropIndex({ table: 't', indexName: '' })).toContain('삭제할 인덱스를 고르세요.')
  })

  it('대상이 있으면 통과한다', () => {
    expect(validateDropTable({ table: 't' })).toEqual([])
    expect(validateDropIndex({ table: 't', indexName: 'ix' })).toEqual([])
  })
})
