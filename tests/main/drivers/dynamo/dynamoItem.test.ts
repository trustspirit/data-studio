import { describe, it, expect } from 'vitest'
import { normalizeItem } from '@main/drivers/dynamo/dynamoItem'

describe('normalizeItem', () => {
  it('스칼라를 그대로 둔다', () => {
    expect(normalizeItem({ a: 'x', n: 3, b: true, z: null })).toEqual({ a: 'x', n: 3, b: true, z: null })
  })
  it('중첩 맵/리스트를 재귀한다', () => {
    expect(normalizeItem({ m: { k: [1, 2] } })).toEqual({ m: { k: [1, 2] } })
  })
  it('Uint8Array를 base64 문자열로 바꾼다', () => {
    expect(normalizeItem({ bin: new Uint8Array([104, 105]) })).toEqual({ bin: 'aGk=' })
  })
  it('Set을 배열로 바꾼다', () => {
    expect(normalizeItem({ s: new Set(['a', 'b']) })).toEqual({ s: ['a', 'b'] })
  })
  it('bigint를 문자열로 바꾼다', () => {
    expect(normalizeItem({ big: 10n })).toEqual({ big: '10' })
  })
  it('전체가 JSON.stringify 가능하다', () => {
    const out = normalizeItem({ bin: new Uint8Array([1]), s: new Set([1]), big: 2n })
    expect(() => JSON.stringify(out)).not.toThrow()
  })
})
