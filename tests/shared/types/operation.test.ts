import { describe, expect, it } from 'vitest'
import {
  DEFAULT_AI_LIMITS,
  DEFAULT_USER_LIMITS,
  resolveLimits,
} from '@shared/types/operation'

describe('resolveLimits', () => {
  it('요청이 없으면 기본값을 그대로 준다', () => {
    expect(resolveLimits(DEFAULT_USER_LIMITS, undefined)).toEqual(DEFAULT_USER_LIMITS)
  })

  it('요청이 기본값보다 엄격하면 요청을 받아들인다', () => {
    const resolved = resolveLimits(DEFAULT_USER_LIMITS, { maxRows: 10 })

    expect(resolved.maxRows).toBe(10)
  })

  it('요청이 기본값보다 느슨하면 기본값으로 눌러 담는다', () => {
    // 상한을 넘겨 받으면 renderer가 보낸 값 하나로 제한이 무의미해진다.
    const resolved = resolveLimits(DEFAULT_USER_LIMITS, {
      maxRows: DEFAULT_USER_LIMITS.maxRows * 100,
      timeoutMs: DEFAULT_USER_LIMITS.timeoutMs * 100,
      maxBytes: DEFAULT_USER_LIMITS.maxBytes * 100,
    })

    expect(resolved).toEqual(DEFAULT_USER_LIMITS)
  })

  it('AI 기본값은 모든 항목에서 사용자 기본값보다 느슨하지 않다', () => {
    // 스펙 §4.4: "AI 경로는 사용자 값보다 완화될 수 없다".
    expect(DEFAULT_AI_LIMITS.timeoutMs).toBeLessThanOrEqual(DEFAULT_USER_LIMITS.timeoutMs)
    expect(DEFAULT_AI_LIMITS.maxRows).toBeLessThanOrEqual(DEFAULT_USER_LIMITS.maxRows)
    expect(DEFAULT_AI_LIMITS.maxBytes).toBeLessThanOrEqual(DEFAULT_USER_LIMITS.maxBytes)
  })

  it('0이나 음수는 기본값으로 되돌린다', () => {
    // maxRows: 0을 그대로 쓰면 아무 행도 못 돌려주면서 커서도 전진하지 않는다.
    const resolved = resolveLimits(DEFAULT_USER_LIMITS, { maxRows: 0, timeoutMs: -1 })

    expect(resolved.maxRows).toBe(DEFAULT_USER_LIMITS.maxRows)
    expect(resolved.timeoutMs).toBe(DEFAULT_USER_LIMITS.timeoutMs)
  })
})
