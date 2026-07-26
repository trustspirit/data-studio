import { describe, expect, it } from 'vitest'
import {
  autoDocuments,
  canOpen,
  documentKey,
  documentTitle,
  openableKinds,
  showsTabBar,
  type Document,
} from '@renderer/entities/document'

const ALL: readonly Document[] = [
  { kind: 'table', schema: 'public', table: 'orders' },
  { kind: 'query', serial: 1 },
  { kind: 'er', schema: 'public' },
  { kind: 'collection' },
  { kind: 'keys' },
  { kind: 'stream' },
  { kind: 'items' },
]

describe('documentKey', () => {
  it('문서 종류마다 서로 다른 신원을 준다', () => {
    const keys = ALL.map(documentKey)
    expect(new Set(keys).size).toBe(ALL.length)
  })

  it('같은 테이블은 같은 신원을 갖는다', () => {
    expect(documentKey({ kind: 'table', schema: 'public', table: 'orders' })).toBe(
      documentKey({ kind: 'table', schema: 'public', table: 'orders' }),
    )
  })

  it('스키마가 다르면 테이블 이름이 같아도 다른 신원이다', () => {
    expect(documentKey({ kind: 'table', schema: 'a', table: 't' })).not.toBe(
      documentKey({ kind: 'table', schema: 'b', table: 't' }),
    )
  })

  it('쿼리는 serial로만 구분된다 — 같은 SQL을 두 탭에 띄울 수 있어야 한다', () => {
    expect(documentKey({ kind: 'query', serial: 1 })).not.toBe(documentKey({ kind: 'query', serial: 2 }))
  })
})

describe('documentTitle', () => {
  it('모든 문서에 비지 않은 제목을 준다', () => {
    for (const doc of ALL) expect(documentTitle(doc).length).toBeGreaterThan(0)
  })

  it('테이블은 테이블 이름을, ER은 스키마를 보여 준다', () => {
    expect(documentTitle({ kind: 'table', schema: 'public', table: 'orders' })).toBe('orders')
    expect(documentTitle({ kind: 'er', schema: 'public' })).toBe('ER: public')
    expect(documentTitle({ kind: 'query', serial: 2 })).toBe('Query 2')
  })
})

describe('capability 규칙', () => {
  it('capability가 없으면 열 수 없다', () => {
    expect(canOpen('table', ['sql'])).toBe(false)
    expect(canOpen('table', ['data'])).toBe(true)
  })

  it('Redis 연결에서는 keys만 열 수 있다', () => {
    expect(openableKinds(['keyvalue'])).toEqual(['keys'])
  })

  it('Postgres 연결에서는 table·query·er을 열 수 있다', () => {
    expect(openableKinds(['sql', 'schema', 'data'])).toEqual(['table', 'query', 'er'])
  })

  it('싱글턴 문서는 접속 직후 자동으로 열린다', () => {
    expect(autoDocuments(['keyvalue'])).toEqual([{ kind: 'keys' }])
    expect(autoDocuments(['stream'])).toEqual([{ kind: 'stream' }])
  })

  it('SQL 연결은 자동으로 열리는 문서가 없다 — 사용자가 트리에서 고른다', () => {
    expect(autoDocuments(['sql', 'schema', 'data'])).toEqual([])
  })

  it('열 수 있는 문서가 싱글턴 하나뿐이면 탭 줄을 감춘다', () => {
    expect(showsTabBar(['keyvalue'])).toBe(false)
    expect(showsTabBar(['document'])).toBe(false)
    expect(showsTabBar(['dynamo'])).toBe(false)
    expect(showsTabBar(['sql', 'schema', 'data'])).toBe(true)
  })
})
