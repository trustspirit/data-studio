import { describe, expect, it } from 'vitest'
import { PostgresDataCapability } from '@main/drivers/postgres/PostgresDataCapability'

const data = new PostgresDataCapability()

describe('PostgresDataCapability.buildBrowse', () => {
  it('스키마·테이블을 인용해 SELECT를 만든다', () => {
    const { sql, params } = data.buildBrowse('public', 'users')
    expect(sql).toBe('SELECT * FROM "public"."users"')
    expect(params).toEqual([])
  })

  it('sort가 있으면 인용된 ORDER BY를 붙인다(asc/desc)', () => {
    expect(data.buildBrowse('public', 'users', { column: 'id', direction: 'asc' }).sql).toBe(
      'SELECT * FROM "public"."users" ORDER BY "id" ASC',
    )
    expect(data.buildBrowse('public', 'users', { column: 'created', direction: 'desc' }).sql).toBe(
      'SELECT * FROM "public"."users" ORDER BY "created" DESC',
    )
  })

  it('식별자에 낀 큰따옴표를 이중화해 인젝션을 막는다', () => {
    // 테이블명이 인용부호를 깨고 나가면 임의 SQL이 붙는다. 반드시 갇혀야 한다.
    const { sql } = data.buildBrowse('public', 'ev"il; DROP TABLE x --')
    expect(sql).toBe('SELECT * FROM "public"."ev""il; DROP TABLE x --"')
    // 내부 큰따옴표가 이중화되지 않았다면 식별자가 조기에 닫혀 페이로드가
    // 새어나간다("ev"il처럼 단일 따옴표로 끊김). 이중화됐는지 직접 확인한다.
    expect(sql).not.toContain('"ev"il')
  })
})
