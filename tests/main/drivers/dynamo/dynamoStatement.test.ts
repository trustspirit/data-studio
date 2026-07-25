import { describe, it, expect } from 'vitest'
import { isReadOnlyStatement } from '@main/drivers/dynamo/dynamoStatement'

describe('isReadOnlyStatement', () => {
  it('SELECT를 허용한다', () => {
    expect(isReadOnlyStatement('SELECT * FROM "t"')).toBe(true)
  })
  it('대소문자·선행 공백 무시', () => {
    expect(isReadOnlyStatement('   select pk FROM "t"')).toBe(true)
    expect(isReadOnlyStatement('sElEcT * FROM "t"')).toBe(true)
  })
  it('선행 주석을 무시한다', () => {
    expect(isReadOnlyStatement('-- comment\nSELECT * FROM "t"')).toBe(true)
    expect(isReadOnlyStatement('/* c */ SELECT * FROM "t"')).toBe(true)
  })
  it('INSERT/UPDATE/DELETE를 거부한다', () => {
    expect(isReadOnlyStatement('INSERT INTO "t" VALUE {\'pk\': \'1\'}')).toBe(false)
    expect(isReadOnlyStatement('UPDATE "t" SET a=1 WHERE pk=\'1\'')).toBe(false)
    expect(isReadOnlyStatement('DELETE FROM "t" WHERE pk=\'1\'')).toBe(false)
  })
  it('빈 문자열을 거부한다', () => {
    expect(isReadOnlyStatement('')).toBe(false)
    expect(isReadOnlyStatement('   ')).toBe(false)
  })
  it('SELECT로 시작하는 다른 단어(SELECTED)는 거부한다', () => {
    expect(isReadOnlyStatement('SELECTED foo')).toBe(false)
  })
})
