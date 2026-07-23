import { describe, it, expect } from 'vitest'
import { normalizeZset, normalizeValue } from '@main/drivers/redis/redisValue'

describe('normalizeZset', () => {
  it('flat [member, score, ...]를 {member, score} 배열로 짝짓는다', () => {
    expect(normalizeZset(['a', '1', 'b', '2.5'])).toEqual([
      { member: 'a', score: 1 },
      { member: 'b', score: 2.5 },
    ])
  })
  it('빈 배열은 빈 결과', () => { expect(normalizeZset([])).toEqual([]) })
  it('홀수 길이는 마지막 짝 안 맞는 원소를 버린다', () => {
    expect(normalizeZset(['a', '1', 'b'])).toEqual([{ member: 'a', score: 1 }])
  })
})

describe('normalizeValue', () => {
  it('string은 그대로', () => { expect(normalizeValue('string', 'hi')).toBe('hi') })
  it('list는 배열 그대로', () => { expect(normalizeValue('list', ['a', 'b'])).toEqual(['a', 'b']) })
  it('set은 배열 그대로', () => { expect(normalizeValue('set', ['x', 'y'])).toEqual(['x', 'y']) })
  it('hash는 객체 그대로', () => { expect(normalizeValue('hash', { f: 'v' })).toEqual({ f: 'v' }) })
  it('zset은 짝지어진 배열', () => {
    expect(normalizeValue('zset', ['a', '1'])).toEqual([{ member: 'a', score: 1 }])
  })
  it('알 수 없는/stream 타입은 null', () => {
    expect(normalizeValue('stream', null)).toBeNull()
    expect(normalizeValue('unknown', null)).toBeNull()
  })
})
