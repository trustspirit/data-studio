import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  parseManifest,
  verifyArtifact,
  verifyUpdate,
} from '@main/infrastructure/update/verifyManifest'
import { parsePublicKey } from '@main/infrastructure/update/minisign'
import { makeKeypair, signContent } from './minisignFixture'

function manifestYaml(version: string): string {
  const artifact = Buffer.from(`artifact for ${version}`)
  const sha512 = createHash('sha512').update(artifact).digest('base64')
  return [
    `version: ${version}`,
    'files:',
    `  - url: Database Studio-${version}-arm64.zip`,
    `    sha512: ${sha512}`,
    '    size: 1234',
    `path: Database Studio-${version}-arm64.zip`,
    `sha512: ${sha512}`,
    '',
  ].join('\n')
}

describe('parseManifest', () => {
  it('version과 files를 뽑는다', () => {
    const parsed = parseManifest(manifestYaml('1.2.3'))

    expect(parsed.version).toBe('1.2.3')
    expect(parsed.files).toHaveLength(1)
    expect(parsed.files[0]?.name).toBe('Database Studio-1.2.3-arm64.zip')
    expect(parsed.files[0]?.size).toBe(1234)
  })

  it('version이 없으면 throw', () => {
    expect(() => parseManifest('files:\n  - url: x\n    sha512: y\n    size: 1')).toThrow(/version/)
  })

  it('files가 없으면 throw', () => {
    expect(() => parseManifest('version: 1.2.3\n')).toThrow(/no files/)
  })
})

describe('verifyUpdate', () => {
  const kp = makeKeypair()
  const pinned = parsePublicKey(kp.publicKeyText)

  function signed(yaml: string) {
    const bytes = Buffer.from(yaml)
    return { manifestBytes: bytes, manifestSig: signContent(kp, bytes) }
  }

  it('유효 서명 + 상위 버전이면 통과한다', () => {
    const result = verifyUpdate({
      ...signed(manifestYaml('2.0.0')),
      pinnedPublicKey: pinned,
      currentVersion: '1.0.0',
    })

    expect(result).toMatchObject({ ok: true, manifest: { version: '2.0.0' } })
  })

  it('서명이 위조되면 bad_signature', () => {
    const s = signed(manifestYaml('2.0.0'))
    const otherKey = makeKeypair()
    const forged = signContent(otherKey, s.manifestBytes)

    const result = verifyUpdate({
      manifestBytes: s.manifestBytes,
      manifestSig: forged,
      pinnedPublicKey: pinned,
      currentVersion: '1.0.0',
    })

    expect(result).toEqual({ ok: false, reason: 'bad_signature' })
  })

  it('유효 서명이지만 낮은 버전이면 downgrade', () => {
    const result = verifyUpdate({
      ...signed(manifestYaml('1.0.0')),
      pinnedPublicKey: pinned,
      currentVersion: '2.0.0',
    })

    expect(result).toEqual({ ok: false, reason: 'downgrade' })
  })

  it('서명 실패가 downgrade보다 우선한다 (서명을 먼저 본다)', () => {
    // 낮은 버전이면서 서명도 위조된 경우, downgrade가 아니라 bad_signature여야
    // 한다 — 서명 안 된 매니페스트의 버전 문자열을 신뢰하지 않는다는 뜻이다.
    const s = signed(manifestYaml('1.0.0'))
    const forged = signContent(makeKeypair(), s.manifestBytes)

    const result = verifyUpdate({
      manifestBytes: s.manifestBytes,
      manifestSig: forged,
      pinnedPublicKey: pinned,
      currentVersion: '2.0.0',
    })

    expect(result).toEqual({ ok: false, reason: 'bad_signature' })
  })

  it('서명은 유효하지만 매니페스트가 깨지면 malformed', () => {
    const bytes = Buffer.from('version: 1.2.3\n(no files here)\n')
    const result = verifyUpdate({
      manifestBytes: bytes,
      manifestSig: signContent(kp, bytes),
      pinnedPublicKey: pinned,
      currentVersion: '1.0.0',
    })

    expect(result).toEqual({ ok: false, reason: 'malformed' })
  })
})

describe('verifyArtifact', () => {
  it('해시가 일치하면 true', () => {
    const bytes = Buffer.from('the artifact')
    const sha512 = createHash('sha512').update(bytes).digest('base64')
    expect(verifyArtifact(bytes, sha512)).toBe(true)
  })

  it('해시가 다르면 false', () => {
    const bytes = Buffer.from('the artifact')
    const wrong = createHash('sha512').update('other').digest('base64')
    expect(verifyArtifact(bytes, wrong)).toBe(false)
  })

  it('한 바이트만 달라도 false', () => {
    const bytes = Buffer.from('the artifact')
    const sha512 = createHash('sha512').update(bytes).digest('base64')
    const tampered = Buffer.from('the artifacX')
    expect(verifyArtifact(tampered, sha512)).toBe(false)
  })
})
