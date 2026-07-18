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
  /** 외부 브라우저로 URL을 여는 함수 (electron shell.openExternal) */
  readonly openExternal: (url: string) => void
}

/** https 스킴만 외부 브라우저로 넘긴다. */
export function isExternalNavigationAllowed(url: string): boolean {
  try {
    return new URL(url).protocol === 'https:'
  } catch {
    return false
  }
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

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalNavigationAllowed(url)) opts.openExternal(url)
    return { action: 'deny' }
  })
}
