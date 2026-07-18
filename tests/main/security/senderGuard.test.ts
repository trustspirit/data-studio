import { describe, expect, it } from 'vitest'
import { createSenderGuard, type InvokeEventLike } from '@main/security/senderGuard'

const ALLOWED = ['http://localhost:5173/']

/** 메인 프레임에서 온 호출 */
function fromMainFrame(url: string | null): InvokeEventLike {
  return {
    senderFrame: url === null ? null : { url },
    sender: { mainFrame: { url: url ?? '' } },
  }
}

/** 서브프레임(iframe)에서 온 호출 — senderFrame과 mainFrame이 다르다 */
function fromSubFrame(subFrameUrl: string): InvokeEventLike {
  return {
    senderFrame: { url: subFrameUrl },
    sender: { mainFrame: { url: 'http://localhost:5173/' } },
  }
}

describe('createSenderGuard', () => {
  it('허용된 정확한 URL의 메인 프레임을 통과시킨다', () => {
    const guard = createSenderGuard(ALLOWED)
    expect(guard(fromMainFrame('http://localhost:5173/'))).toBe(true)
  })

  it('쿼리스트링과 해시는 무시하고 판정한다', () => {
    const guard = createSenderGuard(ALLOWED)
    expect(guard(fromMainFrame('http://localhost:5173/?x=1#/query'))).toBe(true)
  })

  it('senderFrame이 없으면 거부한다', () => {
    const guard = createSenderGuard(ALLOWED)
    expect(guard(fromMainFrame(null))).toBe(false)
  })

  it('서브프레임에서 온 호출은 허용된 URL이어도 거부한다', () => {
    const guard = createSenderGuard(ALLOWED)
    expect(guard(fromSubFrame('http://localhost:5173/embedded'))).toBe(false)
  })

  it('접두사만 같은 유사 origin을 거부한다', () => {
    const guard = createSenderGuard(ALLOWED)
    expect(guard(fromMainFrame('http://localhost:51735/'))).toBe(false)
    expect(guard(fromMainFrame('http://localhost:5173.evil.com/'))).toBe(false)
  })

  it('전혀 다른 origin을 거부한다', () => {
    const guard = createSenderGuard(ALLOWED)
    expect(guard(fromMainFrame('https://evil.example.com/'))).toBe(false)
  })
})
