import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createSecretStore } from '@main/infrastructure/createSecretStore'
import type { SafeStorageLike } from '@main/infrastructure/createSecretStore'
import { EncryptedFileSecretStore } from '@main/infrastructure/EncryptedFileSecretStore'
import type { SecretRef } from '@main/core/ports/SecretStore'

const REF: SecretRef = { kind: 'db-password', ownerId: 'conn-1' }
const PLAINTEXT_CANARY = 'PLAINTEXT-CANARY-9f3ac71b'

/** dir 안의 모든 파일을 읽어 평문 카나리가 어디에도 없는지 확인한다. */
async function assertNoFileContainsPlaintext(dir: string, plaintext: string): Promise<void> {
  const entries = await readdir(dir)
  for (const entry of entries) {
    const contents = await readFile(path.join(dir, entry), 'utf8')
    expect(contents).not.toContain(plaintext)
  }
}

/** 실제 safeStorage 대신 쓰는 가역 변환. 암호화 강도가 아니라 배선을 검증한다. */
function workingSafeStorage(backend = 'gnome_libsecret'): SafeStorageLike {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from(`enc:${s}`, 'utf8'),
    decryptString: (b) => b.toString('utf8').replace(/^enc:/, ''),
    getSelectedStorageBackend: () => backend,
  }
}

let dir = ''
let filePath = ''
const logger = { warn: vi.fn() }

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'datacon-secret-'))
  filePath = path.join(dir, 'secrets.json')
  logger.warn.mockClear()
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('createSecretStore — 암호화 사용 가능', () => {
  it('영속 저장소를 만든다', () => {
    const store = createSecretStore({
      safeStorage: workingSafeStorage(),
      filePath,
      platform: 'darwin',
      logger,
    })

    expect(store.isPersistent()).toBe(true)
  })

  it('저장한 비밀을 다시 읽는다', async () => {
    const store = createSecretStore({
      safeStorage: workingSafeStorage(),
      filePath,
      platform: 'darwin',
      logger,
    })

    await store.set(REF, 'hunter2')

    await expect(store.get(REF)).resolves.toBe('hunter2')
  })

  it('새 인스턴스에서도 비밀이 남아 있다', async () => {
    const deps = {
      safeStorage: workingSafeStorage(),
      filePath,
      platform: 'darwin' as const,
      logger,
    }

    await createSecretStore(deps).set(REF, 'hunter2')

    await expect(createSecretStore(deps).get(REF)).resolves.toBe('hunter2')
  })

  it('없는 비밀은 null을 준다', async () => {
    const store = createSecretStore({
      safeStorage: workingSafeStorage(),
      filePath,
      platform: 'darwin',
      logger,
    })

    await expect(store.get(REF)).resolves.toBeNull()
  })

  it('삭제하면 실제로 사라진다', async () => {
    const store = createSecretStore({
      safeStorage: workingSafeStorage(),
      filePath,
      platform: 'darwin',
      logger,
    })

    await store.set(REF, 'hunter2')
    await store.delete(REF)

    await expect(store.get(REF)).resolves.toBeNull()
  })

  it('삭제는 메모리 캐시가 아니라 디스크에 실제로 반영된다', async () => {
    const store = createSecretStore({
      safeStorage: workingSafeStorage(),
      filePath,
      platform: 'darwin',
      logger,
    })

    await store.set(REF, PLAINTEXT_CANARY)
    await store.delete(REF)

    const rawOnDisk = await readFile(filePath, 'utf8')
    const parsed = JSON.parse(rawOnDisk) as Record<string, string>
    expect(Object.keys(parsed)).not.toContain('db-password:conn-1')

    // 같은 인스턴스가 아니라 새 인스턴스로 확인해서, 메모리 캐시가 아니라
    // 디스크에 쓰인 결과를 검증한다.
    const freshStore = new EncryptedFileSecretStore(filePath, workingSafeStorage(), logger)
    await expect(freshStore.get(REF)).resolves.toBeNull()
  })

  it('종류가 다르면 별개의 비밀로 취급한다', async () => {
    const store = createSecretStore({
      safeStorage: workingSafeStorage(),
      filePath,
      platform: 'darwin',
      logger,
    })

    await store.set({ kind: 'db-password', ownerId: 'x' }, 'a')
    await store.set({ kind: 'llm-api-key', ownerId: 'x' }, 'b')

    await expect(store.get({ kind: 'db-password', ownerId: 'x' })).resolves.toBe('a')
    await expect(store.get({ kind: 'llm-api-key', ownerId: 'x' })).resolves.toBe('b')
  })

  it('파일이 손상돼도 던지지 않고 빈 상태로 시작한다', async () => {
    await writeFile(filePath, 'not json at all', 'utf8')

    const store = createSecretStore({
      safeStorage: workingSafeStorage(),
      filePath,
      platform: 'darwin',
      logger,
    })

    await expect(store.get(REF)).resolves.toBeNull()
    expect(logger.warn).toHaveBeenCalledWith(
      'secrets.corrupt_file',
      expect.objectContaining({ filePath }),
    )
  })

  it('복호화가 실패한 항목은 null을 주고 앱을 죽이지 않는다', async () => {
    const store = createSecretStore({
      safeStorage: {
        isEncryptionAvailable: () => true,
        encryptString: (s) => Buffer.from(`enc:${s}`, 'utf8'),
        decryptString: () => {
          throw new Error('keychain changed')
        },
        getSelectedStorageBackend: () => 'gnome_libsecret',
      },
      filePath,
      platform: 'darwin',
      logger,
    })

    await store.set(REF, 'hunter2')

    await expect(store.get(REF)).resolves.toBeNull()
    expect(logger.warn).toHaveBeenCalledWith(
      'secrets.decrypt_failed',
      expect.objectContaining({ kind: 'db-password' }),
    )
  })
})

describe('createSecretStore — 암호화 불가', () => {
  it('암호화를 못 쓰면 비영속 저장소를 만든다', () => {
    const store = createSecretStore({
      safeStorage: {
        isEncryptionAvailable: () => false,
        encryptString: () => Buffer.alloc(0),
        decryptString: () => '',
      },
      filePath,
      platform: 'linux',
      logger,
    })

    expect(store.isPersistent()).toBe(false)
    expect(logger.warn).toHaveBeenCalledWith(
      'secrets.encryption_unavailable',
      expect.anything(),
    )
  })

  it('Linux basic_text 백엔드는 안전하지 않으므로 영속화를 거부한다', () => {
    const store = createSecretStore({
      safeStorage: workingSafeStorage('basic_text'),
      filePath,
      platform: 'linux',
      logger,
    })

    expect(store.isPersistent()).toBe(false)
    expect(logger.warn).toHaveBeenCalledWith(
      'secrets.insecure_backend',
      expect.objectContaining({ backend: 'basic_text' }),
    )
  })

  it('비영속 저장소도 같은 세션 안에서는 동작한다', async () => {
    const store = createSecretStore({
      safeStorage: workingSafeStorage('basic_text'),
      filePath,
      platform: 'linux',
      logger,
    })

    await store.set(REF, 'hunter2')

    await expect(store.get(REF)).resolves.toBe('hunter2')
  })

  it('비영속 저장소는 새 인스턴스에 값을 넘기지 않는다', async () => {
    const deps = {
      safeStorage: workingSafeStorage('basic_text'),
      filePath,
      platform: 'linux' as const,
      logger,
    }

    await createSecretStore(deps).set(REF, 'hunter2')

    await expect(createSecretStore(deps).get(REF)).resolves.toBeNull()
  })

  it('darwin에서는 백엔드 조회를 하지 않는다', () => {
    const getSelectedStorageBackend = vi.fn(() => 'basic_text')

    createSecretStore({
      safeStorage: {
        isEncryptionAvailable: () => true,
        encryptString: (s) => Buffer.from(s, 'utf8'),
        decryptString: (b) => b.toString('utf8'),
        getSelectedStorageBackend,
      },
      filePath,
      platform: 'darwin',
      logger,
    })

    expect(getSelectedStorageBackend).not.toHaveBeenCalled()
  })

  it('암호화를 못 쓰면 비밀을 저장해도 파일이 생기지 않는다', async () => {
    const store = createSecretStore({
      safeStorage: {
        isEncryptionAvailable: () => false,
        encryptString: () => Buffer.alloc(0),
        decryptString: () => '',
      },
      filePath,
      platform: 'linux',
      logger,
    })

    await store.set(REF, PLAINTEXT_CANARY)

    expect(existsSync(filePath)).toBe(false)
    await expect(readdir(dir)).resolves.toEqual([])
    await assertNoFileContainsPlaintext(dir, PLAINTEXT_CANARY)
  })

  it('Linux basic_text 백엔드에서 비밀을 저장해도 파일이 생기지 않는다', async () => {
    const store = createSecretStore({
      safeStorage: workingSafeStorage('basic_text'),
      filePath,
      platform: 'linux',
      logger,
    })

    await store.set(REF, PLAINTEXT_CANARY)

    expect(existsSync(filePath)).toBe(false)
    await expect(readdir(dir)).resolves.toEqual([])
    await assertNoFileContainsPlaintext(dir, PLAINTEXT_CANARY)
  })

  it('Linux에서 백엔드를 알 수 없으면 비밀을 저장해도 파일이 생기지 않는다', async () => {
    const store = createSecretStore({
      safeStorage: {
        isEncryptionAvailable: () => true,
        encryptString: (s) => Buffer.from(`enc:${s}`, 'utf8'),
        decryptString: (b) => b.toString('utf8').replace(/^enc:/, ''),
        // getSelectedStorageBackend 자체를 제공하지 않는 경우
      },
      filePath,
      platform: 'linux',
      logger,
    })

    await store.set(REF, PLAINTEXT_CANARY)

    expect(existsSync(filePath)).toBe(false)
    await expect(readdir(dir)).resolves.toEqual([])
    await assertNoFileContainsPlaintext(dir, PLAINTEXT_CANARY)
  })
})
