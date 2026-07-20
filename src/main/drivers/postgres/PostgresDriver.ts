import { Client } from 'pg'
import type { ConnectionConfig } from '../../../shared/types/connection'
import type { Driver } from '../../core/driver/Driver'
import type { SchemaCapability } from '../../core/driver/capabilities/SchemaCapability'
import type { SqlCapability } from '../../core/driver/capabilities/SqlCapability'
import { cancelBackend } from './pgCancel'
import { pgSslConfig } from './pgSsl'
import { PostgresSchemaCapability } from './PostgresSchemaCapability'
import { PostgresSqlCapability } from './PostgresSqlCapability'

export interface PgConnParams {
  host: string
  port: number
  database: string
  user: string
  password: string | undefined
  ssl: false | object
}

/** pg.Client의 우리가 쓰는 최소 표면. 테스트 대체를 위해 좁힌다. */
export interface PgClientLike {
  connect(): Promise<void>
  end(): Promise<void>
  query(config: { text: string; values?: readonly unknown[]; rowMode?: 'array' }): Promise<{
    rows: unknown[][] | unknown[]
    fields: { name: string; dataTypeID: number }[]
    rowCount: number | null
    command: string
  }>
  readonly processID: number | null
}

export interface PostgresDriverDeps {
  /** 이 커넥션의 DB 비밀번호. 없으면 null. */
  getPassword: () => Promise<string | null>
  /** 클라이언트 팩토리 주입(테스트/취소 사이드 커넥션용). 생략하면 pg.Client. */
  createClient?: (params: PgConnParams) => PgClientLike
}

export class ConnectionIdentityError extends Error {
  constructor(driverId: string, configId: string) {
    super(`config id ${configId} does not match driver id ${driverId}`)
    this.name = 'ConnectionIdentityError'
  }
}

function defaultCreateClient(params: PgConnParams): PgClientLike {
  return new Client({
    host: params.host,
    port: params.port,
    database: params.database,
    user: params.user,
    password: params.password,
    ssl: params.ssl,
  }) as unknown as PgClientLike
}

export class PostgresDriver implements Driver {
  readonly id: string
  readonly engine = 'postgres' as const
  readonly sql: SqlCapability
  readonly schema: SchemaCapability
  private conn: PgClientLike | null = null
  private password: string | undefined = undefined

  constructor(
    private readonly config: ConnectionConfig,
    private readonly deps: PostgresDriverDeps,
  ) {
    this.id = config.id
    this.sql = new PostgresSqlCapability(
      () => this.requireConn(),
      async () => {
        const pid = this.backendPid
        if (pid === null) return
        // 취소는 best-effort다 — 사이드 커넥션이 실패(잘못된 비밀번호, 연결 거부 등)해도
        // 메인 쿼리의 결과/거부는 그대로 유효하다. 여기서 삼키지 않으면 unhandled
        // rejection이 프로세스로 새어나간다. 이 계층엔 아직 Logger가 배선돼 있지 않다.
        await cancelBackend(() => this.makeClient()(this.connParams(this.password)), pid).catch(
          () => {},
        )
      },
    )
    this.schema = new PostgresSchemaCapability(() => this.requireConn())
  }

  private makeClient(): (params: PgConnParams) => PgClientLike {
    return this.deps.createClient ?? defaultCreateClient
  }

  async connect(config: ConnectionConfig): Promise<void> {
    if (config.id !== this.id) throw new ConnectionIdentityError(this.id, config.id)
    const password = await this.deps.getPassword()
    this.password = password ?? undefined
    const params: PgConnParams = {
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.username,
      password: this.password,
      ssl: pgSslConfig(config.tlsMode, config.host),
    }
    const client = this.makeClient()(params)
    await client.connect()
    this.conn = client
  }

  async disconnect(): Promise<void> {
    const c = this.conn
    this.conn = null
    if (c !== null) await c.end()
  }

  async ping(): Promise<number> {
    const c = this.requireConn()
    const start = performance.now()
    await c.query({ text: 'SELECT 1' })
    return performance.now() - start
  }

  /** connect가 만든 백엔드 PID. 취소(Task 6)가 쓴다. */
  get backendPid(): number | null {
    return this.conn?.processID ?? null
  }

  /** 능력 구현(Task 5/7/8)이 쓰는 접근자. 연결 안 됐으면 던진다. */
  requireConn(): PgClientLike {
    if (this.conn === null) throw new Error(`postgres driver ${this.id} is not connected`)
    return this.conn
  }

  /** 취소 사이드 커넥션이 접속 파라미터를 재사용하도록 노출. */
  connParams(password: string | undefined): PgConnParams {
    return {
      host: this.config.host,
      port: this.config.port,
      database: this.config.database,
      user: this.config.username,
      password,
      ssl: pgSslConfig(this.config.tlsMode, this.config.host),
    }
  }
}
