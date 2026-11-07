import { describe, expect, it } from 'vitest'
import { resultCsv } from '@renderer/entities/result-set/renderers/resultCsv'
import { wire } from '@shared/types/wire'

describe('resultCsv', () => {
  const columns = [{ name: '값', type: 'text' }]
  it('UTF-8 BOM, CRLF와 CSV 인용을 사용한다', () => {
    expect(resultCsv(columns, [[wire.str('a,"b"\nc')]])).toBe('\ufeff"값"\r\n"a,""b""\nc"\r\n')
  })
  it('문자열과 헤더의 수식 실행을 방지한다', () => {
    expect(resultCsv([{ name: '=formula', type: 'text' }], [[wire.str(' \t=cmd()')]])).toBe('\ufeff"\'=formula"\r\n"\' \t=cmd()"\r\n')
  })
  it('음수와 큰 정수, 소수의 원본 값을 유지한다', () => {
    expect(resultCsv(columns, [[wire.int(-12)], [wire.bigint('9007199254740993')], [wire.decimal('-1.001')]]))
      .toContain('"-12"\r\n"9007199254740993"\r\n"-1.001"')
  })
  it('NULL과 빈 문자열을 구분한다', () => {
    expect(resultCsv(columns, [[wire.null()], [wire.str('')]])).toBe('\ufeff"값"\r\n\r\n""\r\n')
  })
})
