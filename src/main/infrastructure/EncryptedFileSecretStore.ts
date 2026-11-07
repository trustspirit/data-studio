import { atomicWriteFile } from './atomicWrite'
import { readJsonFile } from './readJsonFile'
import {
  secretKey,
  type SecretRef,
  type SecretStore,
} from '../core/ports/SecretStore'
import type { Logger } from '../core/ports/Logger'

export interface Encryptor {
  encryptString(value: string): Buffer | Promise<Buffer>
  decryptString(payload: Buffer): string | Promise<string>
}

type Blobs = Record<string, string>

/**
 * 비밀을 플랫폼 암호화로 감싸 base64로 파일에 저장한다.
 * 파일 손상과 복호화 실패는 정상 상태로 처리한다 — 앱을 죽이지 않고
 * 해당 항목을 없는 것으로 취급한다. 커넥션은 재인증 대상이 된다.
 */
export class EncryptedFileSecretStore implements SecretStore {
  private cache: Blobs | null = null
  private loading: Promise<Blobs> | null = null
  private writes: Promise<void> = Promise.resolve()

  constructor(
    private readonly filePath: string,
    private readonly encryptor: Encryptor,
    private readonly logger: Logger,
  ) {}

  isPersistent(): boolean {
    return true
  }

  async set(ref: SecretRef, value: string): Promise<void> {
    return this.mutate(async (blobs) => {
      const encrypted = await this.encryptor.encryptString(value)
      const next = { ...blobs, [secretKey(ref)]: encrypted.toString('base64') }
      await this.persist(next)
    })
  }

  async get(ref: SecretRef): Promise<string | null> {
    await this.writes
    const blobs = await this.load()
    const encoded = blobs[secretKey(ref)]
    if (encoded === undefined) return null

    try {
      return await this.encryptor.decryptString(Buffer.from(encoded, 'base64'))
    } catch {
      this.logger.warn('secrets.decrypt_failed', {
        kind: ref.kind,
        ownerId: ref.ownerId,
      })
      if (ref.kind === 'workspace') throw new Error('작업 복구 데이터를 복호화하지 못했습니다. 원본은 보존됩니다.')
      return null
    }
  }

  async delete(ref: SecretRef): Promise<void> {
    return this.mutate(async (blobs) => {
      const next = { ...blobs }
      delete next[secretKey(ref)]
      await this.persist(next)
    })
  }

  private mutate(change: (blobs: Blobs) => Promise<void>): Promise<void> {
    const next = this.writes.then(async () => change(await this.load()))
    this.writes = next.catch(() => {})
    return next
  }

  private async load(): Promise<Blobs> {
    if (this.cache !== null) return this.cache
    if (this.loading !== null) return this.loading
    this.loading = this.loadFile()
    try { return await this.loading }
    finally { this.loading = null }
  }

  private async loadFile(): Promise<Blobs> {

    const result = await readJsonFile<Blobs>(this.filePath, (raw) => {
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        throw new Error('not an object')
      }
      return raw as Blobs
    })

    if (result.status === 'corrupt') {
      this.logger.warn('secrets.corrupt_file', { filePath: this.filePath })
    }

    this.cache = result.status === 'ok' ? result.value : {}
    return this.cache
  }

  private async persist(blobs: Blobs): Promise<void> {
    await atomicWriteFile(this.filePath, JSON.stringify(blobs))
    this.cache = blobs
  }
}
