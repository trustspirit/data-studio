const VITE_DEV_ORIGIN = 'http://localhost:5173'
const VITE_DEV_WS = 'ws://localhost:5173'

/**
 * renderer에 적용할 Content-Security-Policy 헤더 값을 만든다.
 *
 * `style-src`에 'unsafe-inline'이 필요한 이유: styled-components가 런타임에
 * <style> 엘리먼트를 주입한다. 이 앱은 원격 콘텐츠를 로드하지 않으므로
 * 인라인 스타일의 위험은 제한적이며, script-src는 여전히 잠겨 있다.
 */
export function buildCspHeader(isDev: boolean): string {
  const connectSrc = isDev ? `'self' ${VITE_DEV_ORIGIN} ${VITE_DEV_WS}` : "'self'"
  // dev에서 'unsafe-inline'이 필요한 이유: @vitejs/plugin-react가 react-refresh
  // 프리앰블을 인라인 스크립트로 주입한다. 프로덕션 script-src는 'self'로 잠긴다.
  const scriptSrc = isDev ? `'self' 'unsafe-inline' ${VITE_DEV_ORIGIN}` : "'self'"

  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    `connect-src ${connectSrc}`,
    "object-src 'none'",
    "frame-src 'none'",
    "worker-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ')
}

/**
 * `<meta http-equiv>`로 준 정책에서는 무시되는 디렉티브들(CSP3 §3.3).
 *
 * 헤더 전용 디렉티브가 정책 문자열에 섞이면 브라우저는 그것만 조용히 버리고
 * 나머지를 적용한다 — 정책에는 적혀 있는데 실제로는 꺼져 있는 상태가 되고,
 * 문자열만 보는 테스트는 통과한다. 이 앱이 CSP를 프로덕션에서 통째로 놓친 것도
 * 정확히 그 종류의 침묵이었으므로, 여기서는 빌드를 깨뜨린다.
 */
const META_UNSUPPORTED_DIRECTIVES = ['frame-ancestors', 'report-uri', 'report-to', 'sandbox'] as const

export class CspMetaDeliveryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CspMetaDeliveryError'
  }
}

/** 정책 문자열을 meta content로 쓸 수 있는지 검사하고 그대로 돌려준다. */
export function cspMetaContent(header: string): string {
  const names = header
    .split(';')
    .map((directive) => directive.trim().split(/\s+/)[0]?.toLowerCase() ?? '')
  const unsupported = META_UNSUPPORTED_DIRECTIVES.filter((name) => names.includes(name))
  if (unsupported.length > 0) {
    throw new CspMetaDeliveryError(
      `meta 태그로 전달할 수 없는 디렉티브: ${unsupported.join(', ')} — 헤더 경로로 보내거나 정책에서 빼야 한다`,
    )
  }
  return header
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/** `buildCspHeader`와 같은 정책을 meta 태그 한 줄로 만든다. */
export function buildCspMetaTag(isDev: boolean): string {
  return `<meta http-equiv="Content-Security-Policy" content="${escapeAttribute(cspMetaContent(buildCspHeader(isDev)))}" />`
}

/**
 * renderer HTML에 CSP meta를 꽂는다(빌드 시점 주입).
 *
 * 패키징된 앱은 renderer를 file://로 열고, webRequest는 file://를 가로채지
 * 않으므로 헤더 경로가 통째로 죽는다. Electron 보안 문서가 바로 이 경우에
 * meta 태그를 권한다.
 *
 * `<head>` 바로 뒤에 넣는 이유: meta CSP는 파서가 그 지점을 지난 뒤부터
 * 적용되므로, 스크립트·스타일 태그보다 뒤에 놓이면 그 리소스들이 정책을
 * 빠져나간다. charset meta가 한 줄 밀리지만 정책 길이가 수백 바이트라
 * 인코딩 스니핑 창(1024B) 안에 그대로 남는다.
 *
 * `<head>`가 없거나 CSP meta가 이미 있으면 던진다 — 전자는 주입이 조용히
 * 사라지는 경우이고, 후자는 두 정책이 교집합으로 합쳐져 어느 쪽이 실제로
 * 적용됐는지 알 수 없게 되는 경우다.
 */
export function injectCspMeta(html: string, isDev: boolean): string {
  if (/http-equiv\s*=\s*["']?content-security-policy/i.test(html)) {
    throw new CspMetaDeliveryError('HTML에 CSP meta가 이미 있다 — 정책 출처가 둘로 갈라진다')
  }
  const head = /<head[^>]*>/i.exec(html)
  if (head === null) {
    throw new CspMetaDeliveryError('HTML에 <head>가 없어 CSP meta를 꽂을 자리가 없다')
  }
  const at = head.index + head[0].length
  return `${html.slice(0, at)}\n    ${buildCspMetaTag(isDev)}${html.slice(at)}`
}
