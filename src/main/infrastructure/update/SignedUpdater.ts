import type { AppUpdater, ApplyResult, UpdateStatus } from '../../core/ports/AppUpdater'
import type { MinisignPublicKey } from './minisign'
import { verifyArtifact, verifyUpdate } from './verifyManifest'
import { swapApp, type SwapFs } from './atomicSwap'
import type { UpdateManifest } from '../../core/update/UpdateManifest'

export interface FetchedManifest {
  readonly bytes: Buffer
  readonly sig: string
}

/**
 * 주입 대상. 네트워크·fs·현재버전을 전부 밖에서 받아, 이 클래스를 electron
 * 없이 유닛 테스트할 수 있게 한다.
 */
export interface SignedUpdaterDeps {
  readonly fetchManifest: () => Promise<FetchedManifest>
  readonly downloadArtifact: (name: string) => Promise<Buffer>
  readonly pinnedPublicKey: MinisignPublicKey
  readonly currentVersion: string
  readonly checkWritable: () => Promise<boolean>
  readonly fs: SwapFs
  readonly appPath: string
  readonly stagedPath: string
  readonly backupPath: string
  /** 스테이징 경로에 전개된 아티팩트 바이트를 쓴다. swap 전에 부른다. */
  readonly stageArtifact: (bytes: Buffer, stagedPath: string) => Promise<void>
}

/**
 * 서명을 검증한 뒤에만 업데이트를 적용한다.
 *
 * **순서가 곧 보안이다.** 아티팩트는 **검증된 매니페스트의 이름·해시로만**
 * 받는다 — 검증 안 된 매니페스트가 가리키는 URL을 신뢰하지 않는다. 서명·버전·
 * 해시 중 하나라도 실패하면 그 전에 멈춘다.
 */
export class SignedUpdater implements AppUpdater {
  constructor(private readonly deps: SignedUpdaterDeps) {}

  async checkForUpdate(): Promise<UpdateStatus> {
    let fetched: FetchedManifest
    try {
      fetched = await this.deps.fetchManifest()
    } catch {
      return { kind: 'error' }
    }

    const verified = this.verify(fetched)
    if (!verified.ok) return { kind: 'rejected', reason: verified.reason }

    return { kind: 'available', version: verified.manifest.version }
  }

  async applyUpdate(): Promise<ApplyResult> {
    let fetched: FetchedManifest
    try {
      fetched = await this.deps.fetchManifest()
    } catch {
      return { kind: 'error' }
    }

    // 1. 서명·버전 검증. 통과 전에는 아티팩트를 받지 않는다.
    const verified = this.verify(fetched)
    if (!verified.ok) return { kind: 'rejected', reason: verified.reason }

    const artifact = pickArtifact(verified.manifest)
    if (artifact === null) return { kind: 'error' }

    // 2. 쓰기 권한이 없으면 다운로드도 하지 않고 수동 설치를 안내한다.
    //    권한 상승은 요구하지 않는다(스펙 §9).
    let writable = false
    try {
      writable = await this.deps.checkWritable()
    } catch {
      writable = false
    }
    if (!writable) return { kind: 'manual_install_required' }

    // 3. 검증된 이름으로만 다운로드하고, 검증된 해시와 대조한다.
    let bytes: Buffer
    try {
      bytes = await this.deps.downloadArtifact(artifact.name)
    } catch {
      return { kind: 'error' }
    }
    if (!verifyArtifact(bytes, artifact.sha512)) return { kind: 'artifact_mismatch' }

    // 4. 스테이징 후 원자적 교체.
    try {
      await this.deps.stageArtifact(bytes, this.deps.stagedPath)
    } catch {
      return { kind: 'error' }
    }

    const swap = await swapApp({
      fs: this.deps.fs,
      appPath: this.deps.appPath,
      stagedPath: this.deps.stagedPath,
      backupPath: this.deps.backupPath,
    })
    if (!swap.ok) return { kind: 'swap_failed', rolledBack: swap.rolledBack }

    return { kind: 'applied', version: verified.manifest.version }
  }

  private verify(fetched: FetchedManifest) {
    return verifyUpdate({
      manifestBytes: fetched.bytes,
      manifestSig: fetched.sig,
      pinnedPublicKey: this.deps.pinnedPublicKey,
      currentVersion: this.deps.currentVersion,
    })
  }
}

/** 교체 대상 아티팩트를 고른다. 업데이트에는 zip을 쓴다(dmg는 신규 설치용). */
function pickArtifact(manifest: UpdateManifest) {
  return manifest.files.find((file) => file.name.endsWith('.zip')) ?? manifest.files[0] ?? null
}
