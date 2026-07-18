import { open, rename, unlink } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'

const OWNER_ONLY = 0o600

/**
 * 부분 기록으로 파일이 깨지지 않도록 임시 파일에 쓰고 rename으로 교체한다.
 * rename은 같은 파일시스템 안에서 원자적이다.
 * fsync를 호출해 rename 전에 내용이 디스크에 도달하도록 한다.
 */
export async function atomicWriteFile(filePath: string, contents: string): Promise<void> {
  const tempPath = `${filePath}.${randomUUID()}.tmp`
  const handle = await open(tempPath, 'w', OWNER_ONLY)

  try {
    await handle.writeFile(contents, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }

  try {
    await rename(tempPath, filePath)
  } catch (error) {
    await unlink(tempPath).catch(() => undefined)
    throw error
  }
}
