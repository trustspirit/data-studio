import { describe, it, expect } from 'vitest'
import { PUSH_CHANNELS, isPushChannel } from '@shared/contracts/pushChannels'

describe('pushChannels', () => {
  it('stream:message를 포함한다', () => {
    expect(PUSH_CHANNELS).toContain('stream:message')
  })
  it('isPushChannel은 화이트리스트만 통과시킨다', () => {
    expect(isPushChannel('stream:message')).toBe(true)
    expect(isPushChannel('operation:run')).toBe(false)
    expect(isPushChannel('anything')).toBe(false)
  })
})
