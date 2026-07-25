import { describe, expect, it } from 'vitest'
import { reportedOrigin } from '@main/core/driver/columnOrigin'

describe('reportedOrigin', () => {
  it('원본 이름이 있으면 column 출처로 옮긴다', () => {
    expect(reportedOrigin('users', 'ssn')).toEqual({ kind: 'column', table: 'users', column: 'ssn' })
  })

  it('원본 컬럼 이름이 비면 computed다', () => {
    // MySQL(orgName)과 SQLite(origin_name)는 결과 컬럼이 식일 때 빈 값을 준다.
    // 즉 빈 값은 "모른다"가 아니라 "원본 컬럼이 없다"는 적극적인 보고다.
    expect(reportedOrigin('users', '')).toEqual({ kind: 'computed' })
    expect(reportedOrigin('users', null)).toEqual({ kind: 'computed' })
    expect(reportedOrigin('users', undefined)).toEqual({ kind: 'computed' })
  })

  it('테이블 이름만 없으면 컬럼 출처는 유지하고 table만 null로 둔다', () => {
    // 컬럼 이름을 알면 마스킹 판정은 가능하다 — 테이블을 모른다고 출처를 버리면
    // 별칭 우회가 다시 열린다.
    expect(reportedOrigin('', 'ssn')).toEqual({ kind: 'column', table: null, column: 'ssn' })
    expect(reportedOrigin(null, 'ssn')).toEqual({ kind: 'column', table: null, column: 'ssn' })
  })
})
