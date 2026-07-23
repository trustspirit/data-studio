import Redis, { type RedisOptions } from 'ioredis'
import type { Driver } from '@main/core/driver/Driver'
import type { ConnectionConfig } from '@shared/types/connection'
import { RedisKeyValueCapability } from './RedisKeyValueCapability'

/**
 * ioredis의 `Redis` 클라이언트에서 우리가 쓰는 최소 표면. 테스트 대체를 위해 좁힌다.
 * scan은 `[nextCursor, keys]` 튜플을 준다(ioredis 오버로드 중 MATCH+COUNT 형태).
 */
export interface RedisClientLike {
  connect(): Promise<void>
  quit(): Promise<unknown>
  ping(): Promise<string>
  scan(
    cursor: string, matchToken: 'MATCH', match: string, countToken: 'COUNT', count: number,
  ): Promise<[string, string[]]>
  type(key: string): Promise<string>
  pttl(key: string): Promise<number>
  get(key: string): Promise<string | null>
  lrange(key: string, start: number, stop: number): Promise<string[]>
  smembers(key: string): Promise<string[]>
  hgetall(key: string): Promise<Record<string, string>>
  zrange(key: string, start: number, stop: number, withScores: 'WITHSCORES'): Promise<string[]>
}

export interface RedisConnParams {
  readonly host: string
  readonly port: number
  readonly db: number
  readonly username: string
  readonly password: string | undefined
  readonly tls: boolean
}

export interface RedisDriverDeps {
  getPassword: () => Promise<string | null>
  createClient?: (params: RedisConnParams) => RedisClientLike
}

export class RedisConnectionIdentityError extends Error {
  constructor(driverId: string, configId: string) {
    super(`config id ${configId} does not match driver id ${driverId}`)
    this.name = 'RedisConnectionIdentityError'
  }
}

/** DB 인덱스 파싱. 빈/비정수/음수는 0(fail-safe). */
export function parseDbIndex(database: string): number {
  const n = Number.parseInt(database, 10)
  return Number.isInteger(n) && n >= 0 ? n : 0
}

function defaultCreateClient(params: RedisConnParams): RedisClientLike {
  const options: RedisOptions = {
    host: params.host,
    port: params.port,
    db: params.db,
    // connect()를 우리가 명시적으로 부른다. 재시도 폭주를 막아 연결 실패가 빨리 드러나게 한다.
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    // no-ACL 서버(username 빈 문자열)에 username을 실으면 연결이 깨질 수 있어 생략한다.
    ...(params.username !== '' ? { username: params.username } : {}),
    ...(params.password !== undefined ? { password: params.password } : {}),
    ...(params.tls ? { tls: {} } : {}),
  }
  // ioredis Redis는 우리 좁은 표면을 구조적으로 만족하지만, scan 오버로드가 많아
  // 컴파일러가 곧장 좁히지 못한다 — 좁은 계약으로 단언한다.
  return new Redis(options) as unknown as RedisClientLike
}

export class RedisDriver implements Driver {
  readonly id: string
  readonly engine = 'redis' as const
  private client: RedisClientLike | null = null
  readonly keyValue: RedisKeyValueCapability

  constructor(
    config: ConnectionConfig,
    private readonly deps: RedisDriverDeps,
  ) {
    this.id = config.id
    this.keyValue = new RedisKeyValueCapability(() => this.requireClient())
  }

  private makeClient(): (params: RedisConnParams) => RedisClientLike {
    return this.deps.createClient ?? defaultCreateClient
  }

  async connect(config: ConnectionConfig): Promise<void> {
    if (config.id !== this.id) throw new RedisConnectionIdentityError(this.id, config.id)
    const password = await this.deps.getPassword()
    const params: RedisConnParams = {
      host: config.host,
      port: config.port,
      db: parseDbIndex(config.database),
      username: config.username,
      password: password ?? undefined,
      tls: config.tlsMode !== 'disable',
    }
    const client = this.makeClient()(params)
    await client.connect()
    this.client = client
  }

  async disconnect(): Promise<void> {
    const c = this.client
    this.client = null
    if (c !== null) await c.quit()
  }

  async ping(): Promise<number> {
    const client = this.requireClient()
    const start = performance.now()
    await client.ping()
    return performance.now() - start
  }

  /** 능력 구현(Task 4)이 쓰는 접근자. 연결 안 됐으면 던진다. */
  requireClient(): RedisClientLike {
    if (this.client === null) throw new Error(`redis driver ${this.id} is not connected`)
    return this.client
  }
}
