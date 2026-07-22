import mysql from 'mysql2/promise'
import type { Driver } from '@main/core/driver/Driver'
import type { ConnectionConfig } from '@shared/types/connection'
import { mysqlSslConfig } from './mysqlSsl'

/** 사용하는 mysql2 커넥션 표면만 좁힌다 — 테스트 대체 가능. */
export interface MysqlClientLike {
  query(sql: string, values?: readonly unknown[]): Promise<[unknown, unknown]>
  end(): Promise<void>
  readonly threadId: number | null
}

export interface MysqlConnParams {
  readonly host: string
  readonly port: number
  readonly user: string
  readonly password: string
  readonly database: string
  readonly ssl: false | object
}

export interface MysqlDriverDeps {
  getPassword: () => Promise<string | null>
  /** 테스트 주입 + 취소 side 커넥션 생성용. 기본은 실제 mysql2. */
  createClient?: (params: MysqlConnParams) => Promise<MysqlClientLike>
}

export class MysqlConnectionIdentityError extends Error {
  constructor(expected: string, got: string) {
    super(`mysql driver identity mismatch: expected ${expected}, got ${got}`)
    this.name = 'MysqlConnectionIdentityError'
  }
}

async function defaultCreateClient(params: MysqlConnParams): Promise<MysqlClientLike> {
  const conn = await mysql.createConnection({
    host: params.host,
    port: params.port,
    user: params.user,
    password: params.password,
    database: params.database,
    // exactOptionalPropertyTypes: ssl은 값이 없을 때 키 자체를 생략해야 한다(undefined 대입 불가).
    ...(params.ssl === false ? {} : { ssl: params.ssl }),
    // 정밀도 보존: BIGINT/DECIMAL/DATE 계열을 문자열로 받는다.
    dateStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: true,
    rowsAsArray: false,
  })
  return conn as unknown as MysqlClientLike
}

export class MysqlDriver implements Driver {
  readonly id: string
  readonly engine: 'mysql' | 'mariadb'
  private conn: MysqlClientLike | null = null
  private readonly createClient: (params: MysqlConnParams) => Promise<MysqlClientLike>

  constructor(
    private readonly config: ConnectionConfig,
    private readonly deps: MysqlDriverDeps,
  ) {
    this.id = config.id
    if (config.engine !== 'mysql' && config.engine !== 'mariadb') {
      throw new Error(`MysqlDriver: unexpected engine ${config.engine}`)
    }
    this.engine = config.engine
    this.createClient = deps.createClient ?? defaultCreateClient
  }

  async connect(config: ConnectionConfig): Promise<void> {
    if (config.id !== this.id) throw new MysqlConnectionIdentityError(this.id, config.id)
    if (this.conn) return
    const password = (await this.deps.getPassword()) ?? ''
    this.conn = await this.createClient({
      host: config.host,
      port: config.port,
      user: config.username,
      password,
      database: config.database,
      ssl: mysqlSslConfig(config.tlsMode, config.host),
    })
  }

  async disconnect(): Promise<void> {
    const c = this.conn
    this.conn = null
    if (c) await c.end()
  }

  async ping(): Promise<number> {
    const c = this.requireConn()
    const start = performance.now()
    await c.query('SELECT 1')
    return performance.now() - start
  }

  get threadId(): number | null {
    return this.conn?.threadId ?? null
  }

  private requireConn(): MysqlClientLike {
    if (!this.conn) throw new Error(`mysql driver ${this.id} is not connected`)
    return this.conn
  }
}
