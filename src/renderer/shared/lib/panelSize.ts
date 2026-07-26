/**
 * 패널 크기 지속. 프로덕션은 file:// 오리진으로 로드되므로 localStorage가
 * 막힐 수 있다 — 실패는 기본값으로 떨어지는 것이지 오류가 아니다.
 */
const PREFIX = 'datacon.panel.'

export function readPanelSize(key: string, fallback: number): number {
  try {
    const raw = window.localStorage.getItem(PREFIX + key)
    if (raw === null) return fallback
    const parsed = Number(raw)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
  } catch {
    return fallback
  }
}

export function writePanelSize(key: string, size: number): void {
  try {
    window.localStorage.setItem(PREFIX + key, String(Math.round(size)))
  } catch {
    // 저장이 막힌 환경 — 이번 세션 동안만 크기가 유지된다.
  }
}
