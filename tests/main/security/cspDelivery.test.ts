import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import type { IndexHtmlTransformContext, Plugin, ViteDevServer } from 'vite'
import {
  CspMetaDeliveryError,
  buildCspHeader,
  cspMetaContent,
  injectCspMeta,
} from '@main/security/csp'
import viteConfig, { cspMetaPlugin } from '../../../vite.config'

/**
 * 정책 **문자열**만 검사하던 기존 테스트(windowPolicy.test.ts)는 프로덕션에
 * CSP가 아예 도달하지 않는 상태를 통과시켰다. 여기서는 전달 경로를 검사한다:
 * 실제로 패키징되는 HTML과 실제 vite 플러그인 배선을 그대로 태운다.
 */

const RENDERER_HTML = readFileSync(
  fileURLToPath(new URL('../../../src/renderer/index.html', import.meta.url)),
  'utf8',
)

function metaContentOf(html: string): string {
  const match = /<meta http-equiv="Content-Security-Policy" content="([^"]*)"\s*\/?>/.exec(html)
  if (match === null) throw new Error('주입된 CSP meta를 찾지 못했다')
  return match[1] ?? ''
}

/** vite 플러그인의 transformIndexHtml 훅을 실제 형태 그대로 호출한다. */
function transformViaPlugin(plugin: Plugin, html: string, dev: boolean): string {
  const hook = plugin.transformIndexHtml
  if (hook === undefined || typeof hook === 'function' || !('handler' in hook)) {
    throw new Error('transformIndexHtml이 order를 지정한 객체 훅이 아니다')
  }
  const base = { path: '/index.html', filename: 'src/renderer/index.html' }
  const ctx: IndexHtmlTransformContext = dev
    ? { ...base, server: {} as ViteDevServer }
    : base
  const out = hook.handler(html, ctx)
  if (typeof out !== 'string') throw new Error('훅이 변환된 HTML 문자열을 돌려주지 않았다')
  return out
}

function flatPluginNames(option: unknown): string[] {
  if (Array.isArray(option)) return option.flatMap(flatPluginNames)
  if (typeof option !== 'object' || option === null) return []
  const name = (option as { name?: unknown }).name
  return typeof name === 'string' ? [name] : []
}

describe('CSP 전달 경로', () => {
  it('패키징되는 renderer HTML에 프로덕션 정책이 실제로 실린다', () => {
    // file://로 열리는 빌드에는 webRequest 헤더가 닿지 않는다. meta가 유일한 통로다.
    const out = injectCspMeta(RENDERER_HTML, false)

    expect(out).toContain('http-equiv="Content-Security-Policy"')
    expect(metaContentOf(out)).toContain("connect-src 'self'")
    expect(metaContentOf(out)).not.toContain('ws://')
  })

  it('원본 renderer HTML은 CSP를 스스로 들고 있지 않다', () => {
    // 손으로 적힌 두 번째 정책이 있으면 buildCspHeader가 단일 출처가 아니게 된다.
    expect(RENDERER_HTML).not.toContain('Content-Security-Policy')
  })

  it('주입된 정책은 buildCspHeader와 한 글자도 다르지 않다', () => {
    expect(metaContentOf(injectCspMeta(RENDERER_HTML, false))).toBe(buildCspHeader(false))
    expect(metaContentOf(injectCspMeta(RENDERER_HTML, true))).toBe(buildCspHeader(true))
  })

  it('meta가 어떤 script/style 태그보다 앞에 온다', () => {
    // 파서가 meta를 지나기 전에 로드된 리소스는 정책을 빠져나간다.
    const out = injectCspMeta(RENDERER_HTML, false)
    const metaAt = out.indexOf('http-equiv="Content-Security-Policy"')
    const firstResource = /<(script|style|link)\b/i.exec(out)

    expect(firstResource).not.toBeNull()
    expect(metaAt).toBeLessThan(firstResource?.index ?? -1)
  })

  it('<head>가 없으면 조용히 no-op이 되지 않고 실패한다', () => {
    expect(() => injectCspMeta('<html><body></body></html>', false)).toThrow(CspMetaDeliveryError)
  })

  it('CSP meta가 이미 있으면 정책 출처가 갈라지지 않도록 실패한다', () => {
    const already = injectCspMeta(RENDERER_HTML, false)
    expect(() => injectCspMeta(already, false)).toThrow(CspMetaDeliveryError)
  })

  it('meta로 전달되지 않는 디렉티브를 조용히 버리지 않는다', () => {
    // 정책에는 적혀 있는데 실제로는 꺼진 채 배포되는 것이 최악이다.
    expect(() => cspMetaContent("default-src 'self'; frame-ancestors 'none'")).toThrow(
      CspMetaDeliveryError,
    )
    expect(() => cspMetaContent("default-src 'self'; report-uri /r")).toThrow(CspMetaDeliveryError)
    expect(() => cspMetaContent(buildCspHeader(false))).not.toThrow()
  })
})

describe('vite 배선', () => {
  it('빌드 설정이 CSP 주입 플러그인을 실제로 물고 있다', () => {
    // 플러그인이 훌륭해도 config에서 빠지면 프로덕션은 다시 무방비가 된다.
    expect(flatPluginNames(viteConfig.plugins)).toContain('datacon:csp-meta')
  })

  it('플러그인이 프로덕션 빌드에 원격 연결 금지 정책을 넣는다', () => {
    const out = transformViaPlugin(cspMetaPlugin(), RENDERER_HTML, false)
    expect(metaContentOf(out)).toBe(buildCspHeader(false))
  })

  it('플러그인이 dev 서버에서는 HMR을 허용하는 정책을 넣는다', () => {
    const out = transformViaPlugin(cspMetaPlugin(), RENDERER_HTML, true)
    expect(metaContentOf(out)).toBe(buildCspHeader(true))
    expect(metaContentOf(out)).toContain('ws://localhost:5173')
  })

  it('post 순서로 돌아야 다른 플러그인이 넣은 태그보다 앞설 수 있다', () => {
    expect(cspMetaPlugin().transformIndexHtml).toMatchObject({ order: 'post' })
  })
})
