import Database from 'better-sqlite3'
import type { ConnectionConfig } from '../../../shared/types/connection'
import type { Driver } from '../../core/driver/Driver'
import type { SqlCapability } from '../../core/driver/capabilities/SqlCapability'
import type { SchemaCapability } from '../../core/driver/capabilities/SchemaCapability'
import type { DataCapability } from '../../core/driver/capabilities/DataCapability'
import { SqliteSqlCapability } from './SqliteSqlCapability'
import { SqliteSchemaCapability } from './SqliteSchemaCapability'
import { SqliteDataCapability } from './SqliteDataCapability'

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
  readonly schema: SchemaCapability
  readonly data: DataCapability
  private db: DatabaseInstance | null = null

  constructor(config: ConnectionConfig) {
    this.id = config.id
    this.sql = new SqliteSqlCapability(() => this.requireDb())
    this.schema = new SqliteSchemaCapability(() => this.requireDb())
    this.data = new SqliteDataCapability(() => this.requireDb())
  }

  // better-sqlite3는 동기다 — MemoryDriver 관용구대로 비-async로 Promise를 돌려주고
  // 동기 throw는 try/catch로 rejection으로 바꾼다.
  connect(config: ConnectionConfig): Promise<void> {
    try {
      if (config.id !== this.id) throw new SqliteConnectionIdentityError(this.id, config.id)
      // 재연결(같은 config 재호출)에서 이전 핸들을 흘리지 않는다.
      if (this.db !== null) {
        this.db.close()
        this.db = null
      }
      // fileMustExist: 스튜디오는 기존 DB를 여는 도구다 — 없는 경로에 새 DB를 만들지 않는다.
      this.db = new Database(config.database, { fileMustExist: true })
      return Promise.resolve()
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)))
    }
  }

  disconnect(): Promise<void> {
    const d = this.db
    this.db = null
    if (d !== null) d.close()
    return Promise.resolve()
  }

  ping(): Promise<number> {
    try {
      const d = this.requireDb()
      const start = performance.now()
      d.pragma('user_version')
      return Promise.resolve(performance.now() - start)
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)))
    }
  }

  /** 능력 구현이 쓰는 접근자. 연결 안 됐으면 던진다. */
  requireDb(): DatabaseInstance {
    if (this.db === null) throw new Error(`sqlite driver ${this.id} is not connected`)
    return this.db
  }
}
