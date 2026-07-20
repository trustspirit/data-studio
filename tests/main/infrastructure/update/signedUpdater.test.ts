import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { SignedUpdater, type SignedUpdaterDeps } from '@main/infrastructure/update/SignedUpdater'
import { parsePublicKey } from '@main/infrastructure/update/minisign'
import type { SwapFs } from '@main/infrastructure/update/atomicSwap'
import { makeKeypair, signContent } from './minisignFixture'

const kp = makeKeypair()
const PINNED = parsePublicKey(kp.publicKeyText)

const ARTIFACT = Buffer.from('the new app zip')
const ARTIFACT_SHA = createHash('sha512').update(ARTIFACT).digest('base64')

function manifestYaml(version: string, sha512 = ARTIFACT_SHA): string {
  return [
    `version: ${version}`,
    'files:',
    `  - url: App-${version}-arm64.zip`,
    `    sha512: ${sha512}`,
    '    size: 100',
    '',
  ].join('\n')
}

function signedManifest(version: string, sha512 = ARTIFACT_SHA) {
  const bytes = Buffer.from(manifestYaml(version, sha512))
  return { bytes, sig: signContent(kp, bytes) }
}

function okFs(): SwapFs {
  const paths = new Set(['/app/App.app', '/staged/App.app'])
  return {
    move: (src, dest) => {
      paths.delete(src)
      paths.add(dest)
      return Promise.resolve()
    },
    remove: (p) => {
      paths.delete(p)
      return Promise.resolve()
    },
    healthCheck: () => Promise.resolve(true),
  }
}

function deps(over: Partial<SignedUpdaterDeps> = {}): {
  d: SignedUpdaterDeps
  download: ReturnType<typeof vi.fn>
  stage: ReturnType<typeof vi.fn>
} {
  const download = vi.fn(() => Promise.resolve(ARTIFACT))
  const stage = vi.fn(() => Promise.resolve())
  const d: SignedUpdaterDeps = {
    fetchManifest: () => Promise.resolve(signedManifest('2.0.0')),
    downloadArtifact: download,
    pinnedPublicKey: PINNED,
    currentVersion: '1.0.0',
    checkWritable: () => Promise.resolve(true),
    fs: okFs(),
    appPath: '/app/App.app',
    stagedPath: '/staged/App.app',
    backupPath: '/app/App.app.backup',
    stageArtifact: stage,
    ...over,
  }
  return { d, download, stage }
}

describe('SignedUpdater.checkForUpdate', () => {
  it('유효 서명 + 상위 버전이면 available', async () => {
    const { d } = deps()
    expect(await new SignedUpdater(d).checkForUpdate()).toEqual({ kind: 'available', version: '2.0.0' })
  })

  it('서명 위조면 rejected(bad_signature)', async () => {
    const bytes = Buffer.from(manifestYaml('2.0.0'))
    const forged = signContent(makeKeypair(), bytes)
    const { d } = deps({ fetchManifest: () => Promise.resolve({ bytes, sig: forged }) })

    expect(await new SignedUpdater(d).checkForUpdate()).toEqual({
      kind: 'rejected',
      reason: 'bad_signature',
    })
  })

  it('낮은 버전이면 rejected(downgrade)', async () => {
    const { d } = deps({ fetchManifest: () => Promise.resolve(signedManifest('0.9.0')) })
    expect(await new SignedUpdater(d).checkForUpdate()).toEqual({
      kind: 'rejected',
      reason: 'downgrade',
    })
  })
})

describe('SignedUpdater.applyUpdate', () => {
  it('정상 경로: 검증 통과 → 다운로드 → 교체 → applied', async () => {
    const { d, download } = deps()
    const result = await new SignedUpdater(d).applyUpdate()

    expect(result).toEqual({ kind: 'applied', version: '2.0.0' })
    expect(download).toHaveBeenCalledWith('App-2.0.0-arm64.zip')
  })

  it('서명 위조면 다운로드하지 않고 거부한다', async () => {
    const bytes = Buffer.from(manifestYaml('2.0.0'))
    const forged = signContent(makeKeypair(), bytes)
    const { d, download } = deps({ fetchManifest: () => Promise.resolve({ bytes, sig: forged }) })

    const result = await new SignedUpdater(d).applyUpdate()

    expect(result).toMatchObject({ kind: 'rejected', reason: 'bad_signature' })
    expect(download).not.toHaveBeenCalled()
  })

  it('downgrade면 다운로드하지 않고 거부한다', async () => {
    const { d, download } = deps({ fetchManifest: () => Promise.resolve(signedManifest('0.9.0')) })
    const result = await new SignedUpdater(d).applyUpdate()

    expect(result).toMatchObject({ kind: 'rejected', reason: 'downgrade' })
    expect(download).not.toHaveBeenCalled()
  })

  it('아티팩트 해시가 다르면 교체하지 않는다', async () => {
    // 매니페스트는 유효하게 서명됐지만 다운로드된 바이트가 매니페스트 해시와 다름.
    const { d, stage } = deps({
      downloadArtifact: () => Promise.resolve(Buffer.from('tampered')),
    })
    const result = await new SignedUpdater(d).applyUpdate()

    expect(result).toEqual({ kind: 'artifact_mismatch' })
    expect(stage).not.toHaveBeenCalled()
  })

  it('쓰기 권한이 없으면 다운로드 없이 수동 설치를 안내한다', async () => {
    const { d, download } = deps({ checkWritable: () => Promise.resolve(false) })
    const result = await new SignedUpdater(d).applyUpdate()

    expect(result).toEqual({ kind: 'manual_install_required' })
    expect(download).not.toHaveBeenCalled()
  })

  it('교체가 실패하면 rollback 결과를 전달한다', async () => {
    const fs: SwapFs = {
      move: (src) =>
        src === '/staged/App.app'
          ? Promise.reject(new Error('move failed'))
          : Promise.resolve(),
      remove: () => Promise.resolve(),
      healthCheck: () => Promise.resolve(true),
    }
    const { d } = deps({ fs })
    const result = await new SignedUpdater(d).applyUpdate()

    expect(result).toEqual({ kind: 'swap_failed', rolledBack: true })
  })
})
