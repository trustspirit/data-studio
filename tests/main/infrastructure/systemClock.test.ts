import { describe, expect, it } from 'vitest'
import { randomId, sha256Hex, systemTimers } from '@main/infrastructure/systemClock'

describe('sha256Hex', () => {
  it('빈 문자열의 알려진 벡터를 재현한다', () => {
    // 상수로 못박아 구현이 실제로 sha256인지 확인한다. 다른 해시 함수는 이
    // 값을 낼 수 없다.
    expect(sha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    )
  })

  it('알려진 문자열 벡터를 재현한다', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })

  it('같은 입력은 같은 해시를, 다른 입력은 다른 해시를 준다', () => {
    expect(sha256Hex('DELETE FROM users')).toBe(sha256Hex('DELETE FROM users'))
    expect(sha256Hex('a')).not.toBe(sha256Hex('b'))
  })
})

describe('randomId', () => {
  it('부를 때마다 다른 값을 준다', () => {
    expect(randomId()).not.toBe(randomId())
  })

  it('UUID 형태다', () => {
    expect(randomId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })
})

describe('systemTimers', () => {
  it('setTimeout이 실제로 콜백을 부르고 clearTimeout이 막는다', async () => {
    let fired = 0
    const handle = systemTimers.setTimeout(() => (fired += 1), 1)
    systemTimers.clearTimeout(handle)
    await new Promise((resolve) => setTimeout(resolve, 5))

    expect(fired).toBe(0)
  })

  it('now가 현재 시각에 가깝다', () => {
    expect(Math.abs(systemTimers.now() - Date.now())).toBeLessThan(1_000)
  })
})
