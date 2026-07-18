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
  const scriptSrc = isDev ? `'self' ${VITE_DEV_ORIGIN}` : "'self'"

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
