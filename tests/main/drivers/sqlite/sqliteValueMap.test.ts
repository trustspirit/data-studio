import { describe, expect, it } from 'vitest'
import { sqliteValueMap } from '@main/drivers/sqlite/sqliteValueMap'

describe('sqliteValueMap', () => {
  it('null을 wire null로', () => {
    expect(sqliteValueMap(null)).toEqual({ t: 'null' })
  })
  it('정수 number를 int로, 소수를 float로', () => {
    expect(sqliteValueMap(7)).toEqual({ t: 'int', v: 7 })
    expect(sqliteValueMap(1.5)).toEqual({ t: 'float', v: 1.5 })
  })
  it('bigint를 문자열 bigint로', () => {
    expect(sqliteValueMap(9007199254740993n)).toEqual({ t: 'bigint', v: '9007199254740993' })
  })
  it('string을 str로', () => {
    expect(sqliteValueMap('hi')).toEqual({ t: 'str', v: 'hi' })
  })
  it('Buffer를 base64 bytes로(structuredClone 가능)', () => {
    const wv = sqliteValueMap(Buffer.from([1, 2, 3]))
    expect(wv.t).toBe('bytes')
    expect(structuredClone(wv)).toEqual(wv)
  })
})
