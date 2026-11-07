import { EncryptedFileSecretStore } from './EncryptedFileSecretStore'
import { EphemeralSecretStore } from './EphemeralSecretStore'
import type { SecretStore } from '../core/ports/SecretStore'
import type { Logger } from '../core/ports/Logger'

export interface SafeStorageLike {
  isEncryptionAvailable(): boolean
  encryptString(value: string): Buffer
  decryptString(payload: Buffer): string
  getSelectedStorageBackend?(): string
}

export interface CreateSecretStoreDeps {
  readonly safeStorage: SafeStorageLike
  readonly filePath: string
  readonly platform: NodeJS.Platform
  readonly logger: Logger
}

/**
 * Linux에서 safeStorage는 사용 가능한 키링이 없으면 basic_text로 폴백하는데,
 * 이는 고정 키를 쓰는 사실상 평문이다. 보호받는다고 가정하면 안 되므로
 * 이 경우 영속화를 거부하고 세션 한정 저장소를 준다.
 */
export function createSecretStore(deps: CreateSecretStoreDeps): SecretStore {
  if (!deps.safeStorage.isEncryptionAvailable()) {
    deps.logger.warn('secrets.encryption_unavailable', { platform: deps.platform })
    return new EphemeralSecretStore()
  }

  if (deps.platform === 'linux') {
    const backend = deps.safeStorage.getSelectedStorageBackend?.() ?? 'unknown'
    if (backend === 'basic_text' || backend === 'unknown') {
      deps.logger.warn('secrets.insecure_backend', { backend })
      return new EphemeralSecretStore()
    }
  }

  return new EncryptedFileSecretStore(deps.filePath, deps.safeStorage, deps.logger)
}

interface AsyncSafeStorageLike {
  isAsyncEncryptionAvailable(): Promise<boolean>
  encryptStringAsync(value: string): Promise<Buffer>
  decryptStringAsync(value: Buffer): Promise<{ result: string; shouldReEncrypt: boolean }>
  getSelectedStorageBackend?(): string
}

function bounded<T>(operation: Promise<T>, timeoutMs = 10_000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('암호화 저장소가 잠겨 있거나 응답하지 않습니다.')), timeoutMs)
    operation.then(resolve, reject).finally(() => clearTimeout(timer)).catch(() => {})
  })
}

/** Async keychain access keeps permission prompts from freezing Electron's main thread. */
export async function createAsyncSecretStore(deps: Omit<CreateSecretStoreDeps, 'safeStorage'> & { safeStorage: AsyncSafeStorageLike }): Promise<SecretStore> {
  const available = await bounded(deps.safeStorage.isAsyncEncryptionAvailable()).catch(() => false)
  const backend = deps.platform === 'linux' ? deps.safeStorage.getSelectedStorageBackend?.() ?? 'unknown' : 'os'
  if (!available || backend === 'basic_text' || backend === 'unknown') {
    deps.logger.warn('secrets.encryption_unavailable', { platform: deps.platform })
    return new EphemeralSecretStore()
  }
  return new EncryptedFileSecretStore(deps.filePath, {
    encryptString: (value) => bounded(deps.safeStorage.encryptStringAsync(value)),
    decryptString: async (value) => (await bounded(deps.safeStorage.decryptStringAsync(value))).result,
  }, deps.logger)
}
