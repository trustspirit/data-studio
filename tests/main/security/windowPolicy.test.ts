import { describe, expect, it, vi } from 'vitest'
import {
  applyWindowPolicy,
  type WindowLike,
} from '@main/security/windowPolicy'
import { buildCspHeader } from '@main/security/csp'

type AnyHandler = (...args: never[]) => void

function createFakeWindow() {
  const handlers = new Map<string, AnyHandler>()
  let openHandler: ((details: { url: string }) => { action: string }) | null = null

  const window: WindowLike = {
    webContents: {
      on: (event: string, handler: AnyHandler) => {
        handlers.set(event, handler)
      },
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
    })

    const event = { preventDefault: vi.fn() }
    fake.fire('will-navigate', event, 'http://localhost:5173/')

    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  it('허용되지 않은 URL로의 navigation을 차단한다', () => {
    const fake = createFakeWindow()
    applyWindowPolicy(fake.window, {
      allowedUrls: ['http://localhost:5173/'],
    })

    const event = { preventDefault: vi.fn() }
    fake.fire('will-navigate', event, 'https://evil.example.com/')

    expect(event.preventDefault).toHaveBeenCalledOnce()
  })

  it('새 창 열기를 항상 거부한다', () => {
    const fake = createFakeWindow()
    applyWindowPolicy(fake.window, {
      allowedUrls: ['http://localhost:5173/'],
    })

    expect(fake.openWith('https://example.com/')).toEqual({ action: 'deny' })
  })

  it('https 링크도 외부로 넘기지 않고 거부한다', () => {
    const fake = createFakeWindow()
    applyWindowPolicy(fake.window, {
      allowedUrls: ['http://localhost:5173/'],
    })

    expect(fake.openWith('https://example.com/docs')).toEqual({ action: 'deny' })
  })

  it('자격증명을 실어나르는 형태의 URL을 거부한다', () => {
    const fake = createFakeWindow()
    applyWindowPolicy(fake.window, {
      allowedUrls: ['http://localhost:5173/'],
    })

    // 침해된 renderer가 시도할 법한 유출 형태.
    const exfiltration = `https://evil.example.com/?d=${btoa('postgres://user:hunter2@host/db')}`

    expect(fake.openWith(exfiltration)).toEqual({ action: 'deny' })
  })

  it('어떤 스킴이든 거부한다', () => {
    const fake = createFakeWindow()
    applyWindowPolicy(fake.window, {
      allowedUrls: ['http://localhost:5173/'],
    })

    for (const url of [
      'file:///etc/passwd',
      'javascript:alert(1)',
      'http://example.com/',
      'data:text/html,<script>1</script>',
    ]) {
      expect(fake.openWith(url)).toEqual({ action: 'deny' })
    }
  })

  it('webview 부착을 차단한다', () => {
    const fake = createFakeWindow()
    applyWindowPolicy(fake.window, {
      allowedUrls: ['http://localhost:5173/'],
    })

    const event = { preventDefault: vi.fn() }
    fake.fire('will-attach-webview', event)

    expect(event.preventDefault).toHaveBeenCalledOnce()
  })

  it('userinfo에 허용된 호스트를 심어 실제 호스트(evil.com)를 위장하는 시도를 차단한다', () => {
    const fake = createFakeWindow()
    applyWindowPolicy(fake.window, {
      allowedUrls: ['http://localhost:5173/'],
    })

    const event = { preventDefault: vi.fn() }
    fake.fire('will-navigate', event, 'http://localhost:5173@evil.com/')

    expect(event.preventDefault).toHaveBeenCalledOnce()
  })

  it('백슬래시로 userinfo를 위장하는 시도를 차단한다', () => {
    const fake = createFakeWindow()
    applyWindowPolicy(fake.window, {
      allowedUrls: ['http://localhost:5173/'],
    })

    const event = { preventDefault: vi.fn() }
    fake.fire('will-navigate', event, 'http://localhost:5173\\@evil.com/')

    expect(event.preventDefault).toHaveBeenCalledOnce()
  })

  it('그리스 오미크론으로 유사 표기한 호스트(호모그래프)를 차단한다', () => {
    const fake = createFakeWindow()
    applyWindowPolicy(fake.window, {
      allowedUrls: ['http://localhost:5173/'],
    })

    const event = { preventDefault: vi.fn() }
    // 'localhost'의 'o'를 그리스 문자 오미크론(U+03BF)으로 치환
    fake.fire('will-navigate', event, 'http://lοcalhost:5173/')

    expect(event.preventDefault).toHaveBeenCalledOnce()
  })

  it('허용된 URL을 접두사로 갖는 서브도메인/호스트 접미사 위장을 차단한다', () => {
    const fake = createFakeWindow()
    applyWindowPolicy(fake.window, {
      allowedUrls: ['http://localhost:5173/'],
    })

    const suffixEvent = { preventDefault: vi.fn() }
    fake.fire('will-navigate', suffixEvent, 'http://localhost:5173.evil.com/')
    expect(suffixEvent.preventDefault).toHaveBeenCalledOnce()

    const subdomainEvent = { preventDefault: vi.fn() }
    fake.fire('will-navigate', subdomainEvent, 'http://localhost.evil.com/')
    expect(subdomainEvent.preventDefault).toHaveBeenCalledOnce()
  })

  it('스킴/호스트 대소문자가 다른 동일 URL은 정상적으로 허용한다', () => {
    const fake = createFakeWindow()
    applyWindowPolicy(fake.window, {
      allowedUrls: ['http://localhost:5173/'],
    })

    const event = { preventDefault: vi.fn() }
    fake.fire('will-navigate', event, 'HTTP://LOCALHOST:5173/')

    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  it('trailing slash가 없는 동일 URL은 정상적으로 허용한다', () => {
    const fake = createFakeWindow()
    applyWindowPolicy(fake.window, {
      allowedUrls: ['http://localhost:5173/'],
    })

    const event = { preventDefault: vi.fn() }
    fake.fire('will-navigate', event, 'http://localhost:5173')

    expect(event.preventDefault).not.toHaveBeenCalled()
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
