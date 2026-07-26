// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readPanelSize, writePanelSize } from '@renderer/shared/lib/panelSize'

/**
 * 실행 중인 Node에 실험적 전역 `localStorage`(Web Storage)가 있으면 vitest의 jsdom
 * 환경 연결보다 먼저 전역에 잡혀 있어서 jsdom의 실제 구현을 가린다 — 그 결과
 * `window.localStorage`가 이 Node 전역(파일 없이는 항상 undefined)으로 풀린다.
 * jsdom이 내부적으로 노출하는 실제 window로 위임해 우회한다.
 */
const jsdomGlobal = (globalThis as { jsdom?: { window: Window } }).jsdom
if (jsdomGlobal !== undefined) {
  Object.defineProperty(globalThis, 'localStorage', {
    get: () => jsdomGlobal.window.localStorage,
    configurable: true,
  })
}

afterEach(() => {
  window.localStorage.clear()
  vi.restoreAllMocks()
})

describe('panelSize', () => {
  it('저장한 값을 그대로 읽는다', () => {
    writePanelSize('sidebar', 320)
    expect(readPanelSize('sidebar', 240)).toBe(320)
  })

  it('저장된 값이 없으면 기본값을 준다', () => {
    expect(readPanelSize('sidebar', 240)).toBe(240)
  })

  it('숫자가 아닌 값이 저장돼 있으면 기본값으로 떨어진다', () => {
    window.localStorage.setItem('datacon.panel.sidebar', 'nonsense')
    expect(readPanelSize('sidebar', 240)).toBe(240)
  })

  it('localStorage가 던져도 읽기는 기본값을 주고 쓰기는 조용히 넘어간다', () => {
    // file:// 오리진에서 저장이 막히는 경우를 흉내낸다.
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect(readPanelSize('sidebar', 240)).toBe(240)
    expect(() => writePanelSize('sidebar', 320)).not.toThrow()
  })
})
