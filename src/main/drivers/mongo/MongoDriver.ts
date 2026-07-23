import { MongoClient, type MongoClientOptions } from 'mongodb'
import type { Driver } from '@main/core/driver/Driver'
import type { ConnectionConfig } from '@shared/types/connection'
import { MongoDocumentCapability } from './MongoDocumentCapability'

/** mongodb 드라이버의 cursor(FindCursor/AggregationCursor/ListCollectionsCursor)에서 우리가 쓰는 최소 표면. */
export interface MongoCursorLike<T> {
  toArray(): Promise<T[]>
}

/** `find`에 넘기는 옵션 중 우리가 쓰는 최소 표면. */
export interface MongoFindOptionsLike {
  sort?: Record<string, unknown>
  limit?: number
  signal?: AbortSignal
}

/** `aggregate`/`listCollections`에 넘기는 옵션 중 우리가 쓰는 최소 표면(취소만 필요). */
export interface MongoAbortableOptionsLike {
  signal?: AbortSignal
}

/** mongodb 드라이버의 `Collection`에서 우리가 쓰는 최소 표면. */
export interface MongoCollectionLike {
  find(filter: Record<string, unknown>, options?: MongoFindOptionsLike): MongoCursorLike<Record<string, unknown>>
  aggregate(
    pipeline: Record<string, unknown>[],
    options?: MongoAbortableOptionsLike,
  ): MongoCursorLike<Record<string, unknown>>
}

/** mongodb 드라이버의 `Db`에서 우리가 쓰는 최소 표면. 테스트 대체를 위해 좁힌다. */
export interface MongoDbLike {
  command(command: Record<string, unknown>): Promise<Record<string, unknown>>
  collection(name: string): MongoCollectionLike
  listCollections(
    filter?: Record<string, unknown>,
    options?: MongoAbortableOptionsLike,
  ): MongoCursorLike<{ name: string }>
}

/** mongodb 드라이버의 `MongoClient`에서 우리가 쓰는 최소 표면. 테스트 대체를 위해 좁힌다. */
export interface MongoClientLike {
  connect(): Promise<unknown>
  close(force?: boolean): Promise<void>
  db(dbName?: string): MongoDbLike
}

export interface MongoConnParams {
  /** mongodb 연결 문자열(URI). config.host를 그대로 쓴다. */
  readonly uri: string
  readonly database: string
  readonly username: string
  readonly password: string | undefined
  readonly tls: boolean
}

export interface MongoDriverDeps {
  /** 이 커넥션의 DB 비밀번호. 없으면 null. */
  getPassword: () => Promise<string | null>
  /** 클라이언트 팩토리 주입(테스트용). 생략하면 mongodb.MongoClient. */
  createClient?: (params: MongoConnParams) => MongoClientLike
}

export class MongoConnectionIdentityError extends Error {
  constructor(driverId: string, configId: string) {
    super(`config id ${configId} does not match driver id ${driverId}`)
    this.name = 'MongoConnectionIdentityError'
  }
}

function defaultCreateClient(params: MongoConnParams): MongoClientLike {
  const options: MongoClientOptions = {
    tls: params.tls,
    serverSelectionTimeoutMS: 5000,
    // no-auth 서버(username이 빈 문자열)에 auth 옵션을 실어 보내면 연결이
    // 깨진다 — username이 실제로 있을 때만 auth를 넣는다.
    ...(params.username !== ''
      ? {
          auth: {
            username: params.username,
            // exactOptionalPropertyTypes: password가 없을 때 키 자체를 생략해야
            // 한다(undefined 대입 불가).
            ...(params.password !== undefined ? { password: params.password } : {}),
          },
        }
      : {}),
  }
  return new MongoClient(params.uri, options)
}

export class MongoDriver implements Driver {
  readonly id: string
  readonly engine = 'mongodb' as const
  private client: MongoClientLike | null = null
  private db: MongoDbLike | null = null
  readonly document: MongoDocumentCapability

  constructor(
    config: ConnectionConfig,
    private readonly deps: MongoDriverDeps,
  ) {
    this.id = config.id
    this.document = new MongoDocumentCapability(() => this.requireDb())
  }

  private makeClient(): (params: MongoConnParams) => MongoClientLike {
    return this.deps.createClient ?? defaultCreateClient
  }

  async connect(config: ConnectionConfig): Promise<void> {
    if (config.id !== this.id) throw new MongoConnectionIdentityError(this.id, config.id)
    const password = await this.deps.getPassword()
    const params: MongoConnParams = {
      uri: config.host,
      database: config.database,
      username: config.username,
      password: password ?? undefined,
      tls: config.tlsMode !== 'disable',
    }
    const client = this.makeClient()(params)
    await client.connect()
    this.client = client
    this.db = client.db(config.database)
  }

  async disconnect(): Promise<void> {
    const c = this.client
    this.client = null
    this.db = null
    if (c !== null) await c.close()
  }

  async ping(): Promise<number> {
    const db = this.requireDb()
    const start = performance.now()
    await db.command({ ping: 1 })
    return performance.now() - start
  }

  /** 능력 구현(Task 4)이 쓰는 접근자. 연결 안 됐으면 던진다. */
  requireDb(): MongoDbLike {
    if (this.db === null) throw new Error(`mongo driver ${this.id} is not connected`)
    return this.db
  }
}
