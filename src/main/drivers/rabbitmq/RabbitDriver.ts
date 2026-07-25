import * as amqp from 'amqplib'
import type { Driver } from '@main/core/driver/Driver'
import type { ConnectionConfig } from '@shared/types/connection'
import { buildRabbitConfig, type RabbitAmqpParams, type RabbitMgmtParams } from './rabbitConfig'
import { RabbitStreamCapability } from './RabbitStreamCapability'

/** amqplib 메시지에서 우리가 쓰는 최소 표면. */
export interface AmqpMessageLike {
  content: Buffer
  fields: { exchange: string; routingKey: string; deliveryTag: number }
  properties: { timestamp?: number }
}
export interface AmqpChannelLike {
  assertQueue(queue: string, opts: { exclusive: boolean; autoDelete: boolean }): Promise<{ queue: string }>
  bindQueue(queue: string, exchange: string, pattern: string): Promise<unknown>
  consume(
    queue: string,
    onMsg: (msg: AmqpMessageLike | null) => void,
    opts: { noAck: boolean },
  ): Promise<{ consumerTag: string }>
  close(): Promise<void>
}
export interface AmqpConnectionLike {
  createChannel(): Promise<AmqpChannelLike>
  close(): Promise<void>
}

export interface RabbitDriverDeps {
  getPassword: () => Promise<string | null>
  createConnection?: (params: RabbitAmqpParams) => Promise<AmqpConnectionLike>
  httpGetJson?: (url: string, auth: string) => Promise<unknown>
}

export class RabbitConnectionIdentityError extends Error {
  constructor(driverId: string, configId: string) {
    super(`config id ${configId} does not match driver id ${driverId}`)
    this.name = 'RabbitConnectionIdentityError'
  }
}

async function defaultCreateConnection(params: RabbitAmqpParams): Promise<AmqpConnectionLike> {
  const conn = await amqp.connect({
    protocol: params.protocol,
    hostname: params.hostname,
    port: params.port,
    username: params.username,
    password: params.password,
    vhost: params.vhost,
  })
  return conn
}

async function defaultHttpGetJson(url: string, auth: string): Promise<unknown> {
  const res = await fetch(url, { headers: { Authorization: `Basic ${auth}` } })
  if (!res.ok) throw new Error(`management API ${res.status}: ${url}`)
  return res.json()
}

export class RabbitDriver implements Driver {
  readonly id: string
  readonly engine = 'rabbitmq' as const
  private connection: AmqpConnectionLike | null = null
  private mgmt: RabbitMgmtParams | null = null
  private vhost = '/'
  private readonly channels = new Set<AmqpChannelLike>()
  readonly stream: RabbitStreamCapability

  constructor(
    config: ConnectionConfig,
    private readonly deps: RabbitDriverDeps,
  ) {
    this.id = config.id
    const httpGetJson = deps.httpGetJson ?? defaultHttpGetJson
    this.stream = new RabbitStreamCapability({
      getConnection: () => this.requireConnection(),
      getMgmt: () => this.requireMgmt(),
      getVhost: () => this.vhost,
      httpGetJson,
      trackChannel: (c) => this.channels.add(c),
      untrackChannel: (c) => this.channels.delete(c),
    })
  }

  private makeConnection(): (params: RabbitAmqpParams) => Promise<AmqpConnectionLike> {
    return this.deps.createConnection ?? defaultCreateConnection
  }

  async connect(config: ConnectionConfig): Promise<void> {
    if (config.id !== this.id) throw new RabbitConnectionIdentityError(this.id, config.id)
    const password = await this.deps.getPassword()
    const params = buildRabbitConfig(config, password)
    const connection = await this.makeConnection()(params.amqp)
    this.connection = connection
    this.mgmt = params.mgmt
    this.vhost = params.amqp.vhost
  }

  async disconnect(): Promise<void> {
    const conn = this.connection
    const channels = [...this.channels]
    this.connection = null
    this.mgmt = null
    this.channels.clear()
    await Promise.all(channels.map((c) => c.close().catch(() => {})))
    if (conn !== null) await conn.close()
  }

  async ping(): Promise<number> {
    const conn = this.requireConnection()
    const start = performance.now()
    // AMQP에 ping 프리미티브가 없다 — 채널을 열고 닫아 연결 생존성을 확인한다.
    const ch = await conn.createChannel()
    await ch.close()
    return performance.now() - start
  }

  requireConnection(): AmqpConnectionLike {
    if (this.connection === null) throw new Error(`rabbitmq driver ${this.id} is not connected`)
    return this.connection
  }

  requireMgmt(): RabbitMgmtParams {
    if (this.mgmt === null) throw new Error(`rabbitmq driver ${this.id} is not connected`)
    return this.mgmt
  }
}
