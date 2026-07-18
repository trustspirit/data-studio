export interface FrameLike {
  readonly url: string
}

export interface InvokeEventLike {
  readonly senderFrame: FrameLike | null
  readonly sender: { readonly mainFrame: FrameLike }
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
 * IPC 호출이 앱 자신의 메인 프레임에서 왔는지 검증한다.
 * 서브프레임·팝업·원격 콘텐츠에서 온 호출은 전부 거부한다.
 *
 * 접두사 비교가 아니라 정규화 후 정확 일치를 쓴다. 접두사 비교는
 * 'http://localhost:5173'이 'http://localhost:51735'와 매칭되는 문제가 있다.
 */
export function createSenderGuard(
  allowedUrls: readonly string[],
): (event: InvokeEventLike) => boolean {
  const allowed = new Set(allowedUrls.map(normalize))

  return (event) => {
    const frame = event.senderFrame
    if (frame === null) return false
    if (frame.url !== event.sender.mainFrame.url) return false
    return allowed.has(normalize(frame.url))
  }
}
