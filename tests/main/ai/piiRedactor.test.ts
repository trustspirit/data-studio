import { describe, it, expect } from 'vitest'
import { DefaultPiiRedactor } from '@main/ai/PiiRedactor'
import type { ColumnDescriptor, ColumnOrigin, ResultSet } from '@shared/types/resultSet'
import { wire } from '@shared/types/wire'

/** 원본 컬럼에서 그대로 온 컬럼. */
function col(name: string, origin: string, table = 't'): ColumnDescriptor {
  return { name, type: 'str', origin: { kind: 'column', table, column: origin } }
}

/** 식으로 만들어진 컬럼 — 원본으로 되짚을 수 없다. */
function computed(name: string): ColumnDescriptor {
  return { name, type: 'str', origin: { kind: 'computed' } }
}

/** 엔진이 출처를 보고하지 않은 컬럼(문서·키값·스트림 계열). */
function unreported(name: string): ColumnDescriptor {
  return { name, type: 'str' }
}

/** 원본 컬럼이긴 한데 이름을 알아내지 못한 컬럼(PostgreSQL 카탈로그 조회 실패). */
function unresolved(name: string): ColumnDescriptor {
  return { name, type: 'str', origin: { kind: 'unresolved' } }
}

function rs(columns: readonly ColumnDescriptor[], rows: (string | null)[][]): ResultSet {
  return {
    requestId: 'r',
    columns: [...columns],
    rows: rows.map((r) => r.map((v) => (v === null ? wire.null() : wire.str(v)))),
    page: { cursor: null, hasMore: false, rowCount: rows.length, bytes: 0 },
    meta: { durationMs: 0, truncatedRows: false, truncatedBytes: false, rowsAffected: null },
  }
}

const BIG = 1024 * 1024

describe('DefaultPiiRedactor', () => {
  const r = new DefaultPiiRedactor()

  it('패턴에 부분 문자열 매칭되는 컬럼을 대소문자 무시로 마스킹한다', () => {
    const out = r.redact({
      resultSet: rs([unreported('id'), unreported('user_email'), unreported('EmailAddr')], [['1', 'a@b.com', 'c@d.com']]),
      patterns: ['email'],
      maxBytes: BIG,
      statement: 'SELECT id, user_email, EmailAddr FROM t',
    })
    expect(out.rows[0]?.[0]).toEqual(wire.str('1'))
    expect(out.rows[0]?.[1]).toEqual(wire.str('***'))
    expect(out.rows[0]?.[2]).toEqual(wire.str('***'))
  })

  it('매칭 안 되는 컬럼은 보존한다', () => {
    const out = r.redact({
      resultSet: rs([unreported('id')], [['1']]),
      patterns: ['secret'],
      maxBytes: BIG,
      statement: 'SELECT id FROM t',
    })
    expect(out.rows[0]?.[0]).toEqual(wire.str('1'))
  })

  it('maxBytes를 넘으면 행을 잘라내고 truncatedBytes를 표시한다', () => {
    const big = 'x'.repeat(200)
    const out = r.redact({
      resultSet: rs([unreported('v')], [[big], [big], [big]]),
      patterns: [],
      maxBytes: 300,
      statement: 'SELECT v FROM t',
    })
    expect(out.rows.length).toBeLessThan(3)
    expect(out.meta.truncatedBytes).toBe(true)
  })

  it('빈 패턴이면 마스킹하지 않는다', () => {
    const out = r.redact({
      resultSet: rs([unreported('email')], [['a@b.com']]),
      patterns: [],
      maxBytes: BIG,
      statement: 'SELECT email FROM t',
    })
    expect(out.rows[0]?.[0]).toEqual(wire.str('a@b.com'))
  })

  it('별칭으로 이름을 바꿔도 원본 컬럼이 대상이면 마스킹한다', () => {
    // 이 우회가 이 재설계의 이유다. 표시용 이름만 보던 구현에서는 `s`가 패턴
    // `ssn`에 걸리지 않아 원본 값이 그대로 모델로 나갔다.
    const out = r.redact({
      resultSet: rs([col('s', 'ssn')], [['123-45-6789']]),
      patterns: ['ssn'],
      maxBytes: BIG,
      statement: 'SELECT ssn AS s FROM t',
    })
    expect(out.rows[0]?.[0]).toEqual(wire.str('***'))
  })

  it('원본이 대상이 아니면 이름이 우연히 걸려도 통과시키지 않는다(이름 바닥은 유지)', () => {
    // 이름 판정은 없애지 않고 더한 것이다 — 출처를 보고하지 않는 엔진에서는
    // 그것이 유일한 근거다.
    const out = r.redact({
      resultSet: rs([col('ssn', 'note')], [['plain']]),
      patterns: ['ssn'],
      maxBytes: BIG,
      statement: 'SELECT note AS ssn FROM t',
    })
    expect(out.rows[0]?.[0]).toEqual(wire.str('***'))
  })

  it('마스킹 대상을 참조하는 식 컬럼은 마스킹한다', () => {
    // substr(ssn,1,4)는 원본으로 되짚을 수 없지만 문장이 ssn을 언급한다.
    const out = r.redact({
      resultSet: rs([computed('substr')], [['123-']]),
      patterns: ['ssn'],
      maxBytes: BIG,
      statement: 'SELECT substr(ssn,1,4) FROM t',
    })
    expect(out.rows[0]?.[0]).toEqual(wire.str('***'))
  })

  it('WHERE에만 등장해도 식 컬럼을 마스킹한다(오라클 차단)', () => {
    // count(*)만 돌려받아 이진 탐색으로 마스킹된 값을 알아내는 공격을 막는다.
    // 투영에는 ssn이 없지만 문장에는 있다.
    const out = r.redact({
      resultSet: rs([computed('count')], [['1']]),
      patterns: ['ssn'],
      maxBytes: BIG,
      statement: "SELECT count(*) FROM t WHERE ssn LIKE '123%'",
    })
    expect(out.rows[0]?.[0]).toEqual(wire.str('***'))
  })

  it('마스킹 대상을 건드리지 않는 집계는 그대로 돌려준다', () => {
    // 패턴이 설정됐다는 이유만으로 count(*)까지 가리면 AI가 무해한 일도 못 한다.
    const out = r.redact({
      resultSet: rs([computed('count')], [['42']]),
      patterns: ['ssn'],
      maxBytes: BIG,
      statement: 'SELECT count(*) FROM t',
    })
    expect(out.rows[0]?.[0]).toEqual(wire.str('42'))
  })

  it('문장을 알 수 없으면 되짚을 수 없는 컬럼을 전부 마스킹한다', () => {
    // 판정 근거가 없으면 조이는 쪽으로 간다.
    const out = r.redact({
      resultSet: rs([computed('x'), col('id', 'id')], [['secret', '1']]),
      patterns: ['ssn'],
      maxBytes: BIG,
      statement: null,
    })
    expect(out.rows[0]?.[0]).toEqual(wire.str('***'))
    // 되짚을 수 있고 대상이 아닌 컬럼은 그대로다.
    expect(out.rows[0]?.[1]).toEqual(wire.str('1'))
  })

  it('패턴이 없으면 문장을 몰라도 아무것도 마스킹하지 않는다', () => {
    const out = r.redact({
      resultSet: rs([computed('x')], [['v']]),
      patterns: [],
      maxBytes: BIG,
      statement: null,
    })
    expect(out.rows[0]?.[0]).toEqual(wire.str('v'))
  })

  it('인용 식별자로 감싼 참조도 문장 스캔이 잡는다', () => {
    const origin: ColumnOrigin = { kind: 'computed' }
    const out = r.redact({
      resultSet: rs([{ name: 'v', type: 'str', origin }], [['123-']]),
      patterns: ['ssn'],
      maxBytes: BIG,
      statement: 'SELECT substr("ssn",1,4) AS v FROM t',
    })
    expect(out.rows[0]?.[0]).toEqual(wire.str('***'))
  })

  it('이름을 못 알아낸 원본 컬럼은 computed와 같게 보수적으로 다룬다', () => {
    // PostgreSQL 카탈로그 조회가 실패한 경우. 이름을 모른다는 이유로 통과시키면
    // 별칭 우회가 그대로 되열린다.
    const out = r.redact({
      resultSet: rs([unresolved('s')], [['123-45-6789']]),
      patterns: ['ssn'],
      maxBytes: BIG,
      statement: 'SELECT ssn AS s FROM t',
    })
    expect(out.rows[0]?.[0]).toEqual(wire.str('***'))
  })

  it('출처를 보고하지 않는 엔진에서는 이름 판정에서 멈춘다', () => {
    // 보고 없음을 computed와 같게 다루면, 출처 개념이 없는 엔진(문서·키값·스트림)
    // 에서 문장이 대상을 한 번 언급했다는 이유로 결과 전체가 가려진다. 이
    // 구현의 첫 판이 실제로 그랬고 이 테스트가 그것을 잡았다.
    const out = r.redact({
      resultSet: rs([unreported('id'), unreported('user_email')], [['1', 'a@b.com']]),
      patterns: ['email'],
      maxBytes: BIG,
      statement: 'SELECT id, user_email FROM t',
    })
    expect(out.rows[0]?.[0]).toEqual(wire.str('1'))
    expect(out.rows[0]?.[1]).toEqual(wire.str('***'))
  })
})
