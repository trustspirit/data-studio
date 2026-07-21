import Database from 'better-sqlite3'
import type { ConnectionConfig } from '../../../shared/types/connection'
import type { Driver } from '../../core/driver/Driver'
import type { SqlCapability } from '../../core/driver/capabilities/SqlCapability'
import { SqliteSqlCapability } from './SqliteSqlCapability'

/** better-sqlite3 인스턴스 타입. capability 구현이 공유한다. */
export type DatabaseInstance = Database.Database

export class SqliteConnectionIdentityError extends Error {
  constructor(driverId: string, configId: string) {
    super(`config id ${configId} does not match driver id ${driverId}`)
    this.name = 'SqliteConnectionIdentityError'
  }
}

export class SqliteDriver implements Driver {
  readonly id: string
  readonly engine = 'sqlite' as const
  readonly sql: SqlCapability
  private db: DatabaseInstance | null = null

  constructor(config: ConnectionConfig) {
    this.id = config.id
    this.sql = new SqliteSqlCapability(() => this.requireDb())
  }

  async connect(config: ConnectionConfig): Promise<void> {
    if (config.id !== this.id) throw new SqliteConnectionIdentityError(this.id, config.id)
    // 재연결(같은 config 재호출)에서 이전 핸들을 흘리지 않는다.
    if (this.db !== null) {
      this.db.close()
      this.db = null
    }
    // fileMustExist: 스튜디오는 기존 DB를 여는 도구다 — 없는 경로에 새 DB를 만들지 않는다.
    this.db = new Database(config.database, { fileMustExist: true })
  }

  async disconnect(): Promise<void> {
    const d = this.db
    this.db = null
    if (d !== null) d.close()
  }

  async ping(): Promise<number> {
    const d = this.requireDb()
    const start = performance.now()
    d.pragma('user_version')
    return performance.now() - start
  }

  /** 능력 구현이 쓰는 접근자. 연결 안 됐으면 던진다. */
  requireDb(): DatabaseInstance {
    if (this.db === null) throw new Error(`sqlite driver ${this.id} is not connected`)
    return this.db
  }
}
