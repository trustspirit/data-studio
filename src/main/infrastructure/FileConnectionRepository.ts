import { atomicWriteFile } from './atomicWrite'
import { readJsonFile } from './readJsonFile'
import {
  connectionConfigSchema,
  type ConnectionConfig,
} from '../../shared/types/connection'
import type { ConnectionRepository } from '../core/ports/ConnectionRepository'
import type { Logger } from '../core/ports/Logger'

/**
 * `ConnectionConfig`의 얕은 복사본을 만든다. 최상위 필드는 전부 원시값이지만
 * `maskedColumnPatterns`만 배열이라 `{ ...config }`로는 그 참조가 그대로
 * 공유된다. 배열 원소가 문자열(불변 원시값)이므로 배열 자체만 한 번 더
 * 복사하면 충분하다 — 범용 deep-clone은 이 타입에는 과하다.
 */
function cloneConfig(config: ConnectionConfig): ConnectionConfig {
  return { ...config, maskedColumnPatterns: [...config.maskedColumnPatterns] }
}

/**
 * 커넥션 설정을 JSON 배열로 저장한다.
 * 손상된 파일이나 스키마에 맞지 않는 항목 때문에 앱이 시작하지 못하는 일이
 * 없도록, 읽기 실패는 경고 후 건너뛴다.
 *
 * `get`/`list`가 돌려주는 객체와 `save`가 받는 객체는 모두 캐시와 독립된
 * 복사본이다. 호출자가 반환값이나 넘긴 인자를 그 자리에서 변경해도 내부
 * 캐시(그리고 다음 저장 시 디스크)에는 영향을 주지 않는다.
 */
export class FileConnectionRepository implements ConnectionRepository {
  private cache: ConnectionConfig[] | null = null

  constructor(
    private readonly filePath: string,
    private readonly logger: Logger,
  ) {}

  async list(): Promise<ConnectionConfig[]> {
    return (await this.load()).map(cloneConfig)
  }

  async get(id: string): Promise<ConnectionConfig | null> {
    const found = (await this.load()).find((c) => c.id === id)
    return found ? cloneConfig(found) : null
  }

  /**
   * 기존 id가 있으면 필터 후 push하는 방식으로 교체하므로, 교체된 항목은
   * 배열 맨 뒤로 이동한다. 순서 보장은 제공하지 않는다.
   */
  async save(config: ConnectionConfig): Promise<void> {
    const all = await this.load()
    const next = all.filter((c) => c.id !== config.id)
    next.push(cloneConfig(config))
    await this.persist(next)
  }

  async delete(id: string): Promise<void> {
    const all = await this.load()
    await this.persist(all.filter((c) => c.id !== id))
  }

  private async load(): Promise<ConnectionConfig[]> {
    if (this.cache !== null) return this.cache

    const result = await readJsonFile<unknown[]>(this.filePath, (raw) => {
      if (!Array.isArray(raw)) throw new Error('not an array')
      return raw
    })

    if (result.status === 'corrupt') {
      this.logger.warn('connections.corrupt_file', { filePath: this.filePath })
      this.cache = []
      return this.cache
    }

    const entries = result.status === 'ok' ? result.value : []
    const valid: ConnectionConfig[] = []

    entries.forEach((entry, index) => {
      const parsed = connectionConfigSchema.safeParse(entry)
      if (parsed.success) {
        valid.push(parsed.data)
      } else {
        this.logger.warn('connections.invalid_entry', { index })
      }
    })

    this.cache = valid
    return this.cache
  }

  private async persist(configs: ConnectionConfig[]): Promise<void> {
    this.cache = configs
    await atomicWriteFile(this.filePath, JSON.stringify(configs, null, 2))
  }
}
