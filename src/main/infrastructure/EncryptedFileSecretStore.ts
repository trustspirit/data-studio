import { atomicWriteFile } from './atomicWrite'
import { readJsonFile } from './readJsonFile'
import {
  secretKey,
  type SecretRef,
  type SecretStore,
} from '../core/ports/SecretStore'
import type { Logger } from '../core/ports/Logger'

export interface Encryptor {
  encryptString(value: string): Buffer
  decryptString(payload: Buffer): string
}

type Blobs = Record<string, string>

/**
 * 비밀을 플랫폼 암호화로 감싸 base64로 파일에 저장한다.
 * 파일 손상과 복호화 실패는 정상 상태로 처리한다 — 앱을 죽이지 않고
 * 해당 항목을 없는 것으로 취급한다. 커넥션은 재인증 대상이 된다.
 */
export class EncryptedFileSecretStore implements SecretStore {
  private cache: Blobs | null = null

  constructor(
    private readonly filePath: string,
    private readonly encryptor: Encryptor,
    private readonly logger: Logger,
  ) {}

  isPersistent(): boolean {
    return true
  }

  async set(ref: SecretRef, value: string): Promise<void> {
    const blobs = await this.load()
    blobs[secretKey(ref)] = this.encryptor.encryptString(value).toString('base64')
    await this.persist(blobs)
  }

  async get(ref: SecretRef): Promise<string | null> {
    const blobs = await this.load()
    const encoded = blobs[secretKey(ref)]
    if (encoded === undefined) return null

    try {
      return this.encryptor.decryptString(Buffer.from(encoded, 'base64'))
    } catch {
      this.logger.warn('secrets.decrypt_failed', {
        kind: ref.kind,
        ownerId: ref.ownerId,
      })
      return null
    }
  }

  async delete(ref: SecretRef): Promise<void> {
    const blobs = await this.load()
    delete blobs[secretKey(ref)]
    await this.persist(blobs)
  }

  private async load(): Promise<Blobs> {
    if (this.cache !== null) return this.cache

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
    this.cache = blobs
    await atomicWriteFile(this.filePath, JSON.stringify(blobs))
  }
}
