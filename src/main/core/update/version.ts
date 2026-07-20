/**
 * 버전 비교와 downgrade 판정. 순수 함수 — crypto도 fs도 쓰지 않으므로 core에 둔다.
 */

export interface SemVer {
  readonly major: number
  readonly minor: number
  readonly patch: number
}

/**
 * `v1.2.3` / `1.2.3` / `1.2.3-beta.1`에서 major.minor.patch를 뽑는다.
 * pre-release 꼬리는 비교에 쓰지 않는다(단순화). 형식이 아니면 null.
 */
export function parseVersion(text: string): SemVer | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(text.trim())
  if (match === null) return null

  const major = Number(match[1])
  const minor = Number(match[2])
  const patch = Number(match[3])
  if (!Number.isInteger(major) || !Number.isInteger(minor) || !Number.isInteger(patch)) {
    return null
  }
  return { major, minor, patch }
}

export function compareVersions(a: SemVer, b: SemVer): -1 | 0 | 1 {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1
  return 0
}

/**
 * candidate가 current보다 **엄격히 높을 때만** true.
 *
 * 같거나 낮으면 false다 — 서명이 유효해도(그 버전도 우리가 서명했으니) 오래된
 * 취약 버전으로 내리는 downgrade 공격을 막는다. 둘 중 하나라도 파싱 실패면
 * false다(fail-safe: 판단할 수 없으면 업데이트하지 않는다).
 */
export function isUpgrade(current: string, candidate: string): boolean {
  const a = parseVersion(current)
  const b = parseVersion(candidate)
  if (a === null || b === null) return false
  return compareVersions(a, b) < 0
}
