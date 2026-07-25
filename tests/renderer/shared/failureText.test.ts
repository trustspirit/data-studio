import { describe, expect, it } from 'vitest'
import { failureText } from '@renderer/shared/lib'

describe('failureText', () => {
  it('원문이 있으면 원문을 보여준다', () => {
    expect(failureText({ reason: 'error', detail: 'relation "nope" does not exist' })).toBe(
      'relation "nope" does not exist',
    )
  })

  it('원문이 없으면 코드를 그대로 보여준다', () => {
    // 코드를 한국어로 번역하지 않는다. 'timeout'·'capability_missing'은
    // 그 자체로 읽히고, 매핑 표는 코드가 늘 때마다 조용히 낡는다.
    expect(failureText({ reason: 'timeout' })).toBe('timeout')
    expect(failureText({ reason: 'capability_missing' })).toBe('capability_missing')
  })

  it('빈 원문은 없는 것으로 본다', () => {
    expect(failureText({ reason: 'error', detail: '' })).toBe('error')
    expect(failureText({ reason: 'error', detail: '   ' })).toBe('error')
  })
})
