import { createHash } from 'node:crypto'
import { isUpgrade } from '../../core/update/version'
import type { UpdateArtifact, UpdateManifest } from '../../core/update/UpdateManifest'
import { verifyMinisign, type MinisignPublicKey } from './minisign'

/**
 * 업데이트 매니페스트 검증: 서명 → 파싱 → downgrade 순.
 *
 * **서명을 파싱·버전 판정보다 먼저** 한다 — 서명되지 않은 매니페스트의 버전
 * 문자열을 신뢰하지 않는다. 서명이 오염된 매니페스트로 downgrade 여부를
 * 따지는 것 자체가 오염된 데이터를 신뢰하는 일이다.
 */

export type VerifyResult =
  | { readonly ok: true; readonly manifest: UpdateManifest }
  | { readonly ok: false; readonly reason: 'bad_signature' | 'downgrade' | 'malformed' }

export interface VerifyInput {
  readonly manifestBytes: Buffer
  readonly manifestSig: string
  readonly pinnedPublicKey: MinisignPublicKey
  readonly currentVersion: string
}

export function verifyUpdate(input: VerifyInput): VerifyResult {
  // 1. 서명 먼저. 실패면 매니페스트 내용을 아예 신뢰하지 않는다.
  if (!verifyMinisign(input.manifestBytes, input.manifestSig, input.pinnedPublicKey)) {
    return { ok: false, reason: 'bad_signature' }
  }

  // 2. 서명이 검증된 뒤에만 파싱한다.
  let manifest: UpdateManifest
  try {
    manifest = parseManifest(input.manifestBytes.toString('utf8'))
  } catch {
    return { ok: false, reason: 'malformed' }
  }

  // 3. downgrade 방지. 서명이 유효해도 낮은/같은 버전이면 거부한다.
  if (!isUpgrade(input.currentVersion, manifest.version)) {
    return { ok: false, reason: 'downgrade' }
  }

  return { ok: true, manifest }
}

/**
 * electron-updater `latest-mac.yml`에서 우리가 쓰는 필드만 뽑는다.
 * 전체 YAML 파서는 새 의존성이라 쓰지 않는다 — version과 files의
 * url/sha512/size만 라인 기반으로 읽는다. 형식이 어긋나면 throw.
 *
 * **줄 끝은 LF를 가정한다.** electron-builder는 macOS 러너에서 LF로 매니페스트를
 * 내며, 서명은 그 바이트 위에 걸린다 — 서명자와 파서가 같은 바이트를 본다.
 * CRLF 매니페스트는 malformed로 **거부**된다(fail-closed): 파싱을 못 해 나쁜
 * 매니페스트를 통과시키는 것이 아니라 거부하는 쪽이므로 보안상 안전하다.
 */
export function parseManifest(yaml: string): UpdateManifest {
  const lines = yaml.split('\n')

  const version = readScalar(lines, 'version')
  if (version === null) throw new Error('manifest: missing version')

  const files: UpdateArtifact[] = []
  let current: { name?: string; sha512?: string; size?: number } | null = null

  for (const line of lines) {
    const item = /^\s*-\s+url:\s*(.+)$/.exec(line)
    if (item !== null) {
      if (current !== null) files.push(finishArtifact(current))
      current = { name: unquote(item[1] ?? '') }
      continue
    }
    if (current === null) continue

    const sha = /^\s+sha512:\s*(.+)$/.exec(line)
    if (sha !== null) {
      current.sha512 = unquote(sha[1] ?? '')
      continue
    }
    const size = /^\s+size:\s*(\d+)\s*$/.exec(line)
    if (size !== null) {
      current.size = Number(size[1])
      continue
    }
  }
  if (current !== null) files.push(finishArtifact(current))

  if (files.length === 0) throw new Error('manifest: no files')

  return { version, files }
}

function finishArtifact(partial: { name?: string; sha512?: string; size?: number }): UpdateArtifact {
  if (partial.name === undefined || partial.sha512 === undefined || partial.size === undefined) {
    throw new Error('manifest: incomplete file entry')
  }
  return { name: partial.name, sha512: partial.sha512, size: partial.size }
}

function readScalar(lines: readonly string[], key: string): string | null {
  for (const line of lines) {
    const match = new RegExp(`^${key}:\\s*(.+)$`).exec(line)
    if (match !== null) return unquote(match[1] ?? '')
  }
  return null
}

function unquote(value: string): string {
  const trimmed = value.trim()
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

/** 다운로드한 아티팩트의 SHA-512(base64)가 매니페스트 값과 일치하는지. */
export function verifyArtifact(bytes: Buffer, expectedSha512Base64: string): boolean {
  const actual = createHash('sha512').update(bytes).digest('base64')
  return actual === expectedSha512Base64
}
