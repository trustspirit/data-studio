import { describe, it, expect } from 'vitest'
import { DefaultPiiRedactor } from '@main/ai/PiiRedactor'
import type { ResultSet } from '@shared/types/resultSet'
import { wire } from '@shared/types/wire'

function rs(columns: string[], rows: unknown[][]): ResultSet {
  return {
    requestId: 'r',
    columns: columns.map((name) => ({ name, type: 'str' })),
    rows: rows.map((r) => r.map((v) => (v === null ? wire.null() : wire.str(String(v))))),
    page: { cursor: null, hasMore: false, rowCount: rows.length, bytes: 0 },
    meta: { durationMs: 0, truncatedRows: false, truncatedBytes: false, rowsAffected: null },
  }
}

describe('DefaultPiiRedactor', () => {
  const r = new DefaultPiiRedactor()

  it('패턴에 부분 문자열 매칭되는 컬럼을 대소문자 무시로 마스킹한다', () => {
    const out = r.redact(rs(['id', 'user_email', 'EmailAddr'], [['1', 'a@b.com', 'c@d.com']]), ['email'], 1024 * 1024)
    expect(out.rows[0]?.[0]).toEqual(wire.str('1'))
    expect(out.rows[0]?.[1]).toEqual(wire.str('***'))
    expect(out.rows[0]?.[2]).toEqual(wire.str('***'))
  })

  it('매칭 안 되는 컬럼은 보존한다', () => {
    const out = r.redact(rs(['id'], [['1']]), ['secret'], 1024 * 1024)
    expect(out.rows[0]?.[0]).toEqual(wire.str('1'))
  })

  it('maxBytes를 넘으면 행을 잘라내고 truncatedBytes를 표시한다', () => {
    const big = 'x'.repeat(200)
    const out = r.redact(rs(['v'], [[big], [big], [big]]), [], 300)
    expect(out.rows.length).toBeLessThan(3)
    expect(out.meta.truncatedBytes).toBe(true)
  })

  it('빈 패턴이면 마스킹하지 않는다', () => {
    const out = r.redact(rs(['email'], [['a@b.com']]), [], 1024 * 1024)
    expect(out.rows[0]?.[0]).toEqual(wire.str('a@b.com'))
  })
})
