import { atomicWriteFile } from './atomicWrite'
import { readJsonFile } from './readJsonFile'
import {
  connectionConfigSchema,
  type ConnectionConfig,
} from '../../shared/types/connection'
import type { ConnectionRepository } from '../core/ports/ConnectionRepository'
import type { Logger } from '../core/ports/Logger'

/**
 * 커넥션 설정을 JSON 배열로 저장한다.
 * 손상된 파일이나 스키마에 맞지 않는 항목 때문에 앱이 시작하지 못하는 일이
 * 없도록, 읽기 실패는 경고 후 건너뛴다.
 */
export class FileConnectionRepository implements ConnectionRepository {
  private cache: ConnectionConfig[] | null = null

  constructor(
    private readonly filePath: string,
    private readonly logger: Logger,
  ) {}

  async list(): Promise<ConnectionConfig[]> {
    return [...(await this.load())]
  }

  async get(id: string): Promise<ConnectionConfig | null> {
    return (await this.load()).find((c) => c.id === id) ?? null
  }

  async save(config: ConnectionConfig): Promise<void> {
    const all = await this.load()
    const next = all.filter((c) => c.id !== config.id)
    next.push(config)
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
