import { describe, expect, it, vi } from 'vitest'
import {
  applyWindowPolicy,
  isExternalNavigationAllowed,
  type WindowLike,
} from '@main/security/windowPolicy'
import { buildCspHeader } from '@main/security/csp'

type AnyHandler = (...args: never[]) => void

function createFakeWindow() {
  const handlers = new Map<string, AnyHandler>()
  let openHandler: ((details: { url: string }) => { action: string }) | null = null

  const window: WindowLike = {
    webContents: {
      on: ((event: string, handler: AnyHandler) => {
        handlers.set(event, handler)
      }) as WindowLike['webContents']['on'],
      setWindowOpenHandler(handler) {
        openHandler = handler
      },
    },
  }

  return {
    window,
    fire(event: string, ...args: unknown[]) {
      const handler = handlers.get(event)
      if (handler === undefined) throw new Error(`no handler for ${event}`)
      return (handler as (...a: unknown[]) => unknown)(...args)
    },
    openWith(url: string) {
      if (openHandler === null) throw new Error('no window open handler')
      return openHandler({ url })
    },
  }
}

describe('applyWindowPolicy', () => {
  it('허용된 URL로의 navigation은 통과시킨다', () => {
    const fake = createFakeWindow()
    applyWindowPolicy(fake.window, {
      allowedUrls: ['http://localhost:5173/'],
      openExternal: vi.fn(),
    })

    const event = { preventDefault: vi.fn() }
    fake.fire('will-navigate', event, 'http://localhost:5173/')

    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  it('허용되지 않은 URL로의 navigation을 차단한다', () => {
    const fake = createFakeWindow()
    applyWindowPolicy(fake.window, {
      allowedUrls: ['http://localhost:5173/'],
      openExternal: vi.fn(),
    })

    const event = { preventDefault: vi.fn() }
    fake.fire('will-navigate', event, 'https://evil.example.com/')

    expect(event.preventDefault).toHaveBeenCalledOnce()
  })

  it('새 창 열기를 항상 거부한다', () => {
    const fake = createFakeWindow()
    applyWindowPolicy(fake.window, {
      allowedUrls: ['http://localhost:5173/'],
      openExternal: vi.fn(),
    })

    expect(fake.openWith('https://example.com/')).toEqual({ action: 'deny' })
  })

  it('https 링크는 외부 브라우저로 넘긴다', () => {
    const openExternal = vi.fn()
    const fake = createFakeWindow()
    applyWindowPolicy(fake.window, {
      allowedUrls: ['http://localhost:5173/'],
      openExternal,
    })

    fake.openWith('https://example.com/docs')

    expect(openExternal).toHaveBeenCalledWith('https://example.com/docs')
  })

  it('https가 아닌 스킴은 외부로 넘기지 않는다', () => {
    const openExternal = vi.fn()
    const fake = createFakeWindow()
    applyWindowPolicy(fake.window, {
      allowedUrls: ['http://localhost:5173/'],
      openExternal,
    })

    fake.openWith('file:///etc/passwd')
    fake.openWith('javascript:alert(1)')

    expect(openExternal).not.toHaveBeenCalled()
  })

  it('webview 부착을 차단한다', () => {
    const fake = createFakeWindow()
    applyWindowPolicy(fake.window, {
      allowedUrls: ['http://localhost:5173/'],
      openExternal: vi.fn(),
    })

    const event = { preventDefault: vi.fn() }
    fake.fire('will-attach-webview', event)

    expect(event.preventDefault).toHaveBeenCalledOnce()
  })
})

describe('isExternalNavigationAllowed', () => {
  it('https만 허용한다', () => {
    expect(isExternalNavigationAllowed('https://example.com')).toBe(true)
    expect(isExternalNavigationAllowed('http://example.com')).toBe(false)
    expect(isExternalNavigationAllowed('file:///tmp/x')).toBe(false)
    expect(isExternalNavigationAllowed('javascript:alert(1)')).toBe(false)
    expect(isExternalNavigationAllowed('not-a-url')).toBe(false)
  })
})

describe('buildCspHeader', () => {
  it('프로덕션에서 원격 스크립트와 연결을 금지한다', () => {
    const csp = buildCspHeader(false)

    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("script-src 'self'")
    expect(csp).toContain("connect-src 'self'")
    expect(csp).toContain("object-src 'none'")
    expect(csp).toContain("frame-src 'none'")
    expect(csp).not.toContain('ws://')
  })

  it('개발 모드에서는 vite HMR 웹소켓을 허용한다', () => {
    const csp = buildCspHeader(true)

    expect(csp).toContain('ws://localhost:5173')
  })
})
