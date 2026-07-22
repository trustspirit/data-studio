import mysql from 'mysql2/promise'
import type { Driver } from '@main/core/driver/Driver'
import type { ConnectionConfig } from '@shared/types/connection'
import { cancelQuery } from './mysqlCancel'
import { mysqlSslConfig } from './mysqlSsl'
import { MysqlDataCapability } from './MysqlDataCapability'
import { MysqlSchemaCapability } from './MysqlSchemaCapability'
import { MysqlSqlCapability } from './MysqlSqlCapability'

/** 사용하는 mysql2 커넥션 표면만 좁힌다 — 테스트 대체 가능. */
export interface MysqlClientLike {
  query(sql: string, values?: readonly unknown[]): Promise<[unknown, unknown]>
  /**
   * 옵션 객체 형태(mysql2 `QueryOptions`의 부분집합). `rowsAsArray: true`로
   * SELECT 결과를 배열-of-배열로 받아야 컬럼 순서를 유지한 채 `mapMysqlValue`에
   * 넘길 수 있다 — Task 3(SqlCapability)이 필요로 해서 넓혔다(Task 2 파일 수정).
   */
  query(options: {
    sql: string
    values?: readonly unknown[]
    rowsAsArray?: boolean
  }): Promise<[unknown, unknown]>
  end(): Promise<void>
  readonly threadId: number | null
  /**
   * 트랜잭션 제어 3종. mysql2 promise 커넥션이 제공한다 — DataCapability의
   * applyChanges가 편집을 하나의 트랜잭션으로 원자 실행하는 데 필요해서
   * 넓혔다(Task 5가 필요로 해서 넓힘, Task 2 파일 수정).
   */
  beginTransaction(): Promise<void>
  commit(): Promise<void>
  rollback(): Promise<void>
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
  readonly sql: MysqlSqlCapability
  readonly schema: MysqlSchemaCapability
  readonly data: MysqlDataCapability
  private conn: MysqlClientLike | null = null
  private password = ''
  /** connect()에 실제로 넘어온 config. 취소 side 커넥션이 같은 접속 정보를 재사용하도록 기억해 둔다. */
  private connectedConfig: ConnectionConfig | null = null
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
    this.sql = new MysqlSqlCapability(
      () => this.requireConn(),
      async () => {
        const tid = this.threadId
        if (tid === null) return
        // 취소는 best-effort다 — side 커넥션 실패(권한 부족, 연결 거부 등)가
        // 나도 메인 쿼리의 결과/거부는 그대로 유효하다. 여기서 삼키지 않으면
        // unhandled rejection이 프로세스로 새어나간다. 이 계층엔 아직 Logger가
        // 배선돼 있지 않다.
        await cancelQuery(() => this.createClient(this.connParams()), tid).catch(() => {})
      },
      this.engine,
    )
    this.schema = new MysqlSchemaCapability(() => this.requireConn())
    this.data = new MysqlDataCapability(() => this.requireConn())
  }

  async connect(config: ConnectionConfig): Promise<void> {
    if (config.id !== this.id) throw new MysqlConnectionIdentityError(this.id, config.id)
    if (this.conn) return
    this.password = (await this.deps.getPassword()) ?? ''
    this.connectedConfig = config
    this.conn = await this.createClient(this.connParams())
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

  /** 취소 side 커넥션이 접속 파라미터를 재사용하도록 노출. connect() 이후에만 의미가 있다. */
  private connParams(): MysqlConnParams {
    const c = this.connectedConfig ?? this.config
    return {
      host: c.host,
      port: c.port,
      user: c.username,
      password: this.password,
      database: c.database,
      ssl: mysqlSslConfig(c.tlsMode, c.host),
    }
  }
}
