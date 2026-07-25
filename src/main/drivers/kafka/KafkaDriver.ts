import { Kafka, logLevel, type SASLOptions } from 'kafkajs'
import type { Driver } from '@main/core/driver/Driver'
import type { ConnectionConfig } from '@shared/types/connection'
import { buildKafkaConfig, type KafkaConnParams } from './kafkaConfig'
import { KafkaStreamCapability } from './KafkaStreamCapability'

/** kafkajs 메시지에서 우리가 쓰는 최소 표면. */
export interface KafkaMessageLike {
  key: Buffer | null
  value: Buffer | null
  timestamp: string
  offset: string
}
export interface EachMessagePayloadLike {
  topic: string
  partition: number
  message: KafkaMessageLike
}
export interface KafkaConsumerLike {
  connect(): Promise<void>
  disconnect(): Promise<void>
  subscribe(opts: { topic: string; fromBeginning: boolean }): Promise<void>
  run(opts: { autoCommit: boolean; eachMessage: (payload: EachMessagePayloadLike) => Promise<void> }): Promise<void>
}
export interface KafkaAdminLike {
  connect(): Promise<void>
  disconnect(): Promise<void>
  listTopics(): Promise<string[]>
}
export interface KafkaClientLike {
  admin(): KafkaAdminLike
  consumer(config: { groupId: string }): KafkaConsumerLike
}

export interface KafkaDriverDeps {
  getPassword: () => Promise<string | null>
  createClient?: (params: KafkaConnParams) => KafkaClientLike
  /** groupId 생성(테스트 결정성). 생략하면 crypto.randomUUID. */
  randomId?: () => string
}

export class KafkaConnectionIdentityError extends Error {
  constructor(driverId: string, configId: string) {
    super(`config id ${configId} does not match driver id ${driverId}`)
    this.name = 'KafkaConnectionIdentityError'
  }
}

function defaultCreateClient(params: KafkaConnParams): KafkaClientLike {
  const kafka = new Kafka({
    clientId: params.clientId,
    brokers: [...params.brokers],
    ssl: params.ssl,
    logLevel: logLevel.NOTHING,
    // kafkajs SASLOptions는 mechanism 리터럴로 판별하는 유니온이라 우리의
    // 넓은 KafkaSaslMechanism 유니온을 구조적으로 받아들이지 못한다 — 단언한다.
    ...(params.sasl === undefined ? {} : { sasl: params.sasl as unknown as SASLOptions }),
  })
  // kafkajs Admin/Consumer는 우리 좁은 표면을 구조적으로 만족하지만 타입이 넓어
  // 곧장 좁히지 못한다 — 좁은 계약으로 단언한다.
  return kafka as unknown as KafkaClientLike
}

export class KafkaDriver implements Driver {
  readonly id: string
  readonly engine = 'kafka' as const
  private client: KafkaClientLike | null = null
  private admin: KafkaAdminLike | null = null
  private readonly consumers = new Set<KafkaConsumerLike>()
  private readonly randomId: () => string
  readonly stream: KafkaStreamCapability

  constructor(
    config: ConnectionConfig,
    private readonly deps: KafkaDriverDeps,
  ) {
    this.id = config.id
    this.randomId = deps.randomId ?? (() => crypto.randomUUID())
    this.stream = new KafkaStreamCapability({
      getAdmin: () => this.requireAdmin(),
      newConsumer: () => this.newConsumer(),
      nextGroupId: () => this.nextGroupId(),
      trackConsumer: (c) => this.consumers.add(c),
      untrackConsumer: (c) => this.consumers.delete(c),
    })
  }

  private makeClient(): (params: KafkaConnParams) => KafkaClientLike {
    return this.deps.createClient ?? defaultCreateClient
  }

  async connect(config: ConnectionConfig): Promise<void> {
    if (config.id !== this.id) throw new KafkaConnectionIdentityError(this.id, config.id)
    const password = await this.deps.getPassword()
    const client = this.makeClient()(buildKafkaConfig(config, password))
    const admin = client.admin()
    await admin.connect()
    this.client = client
    this.admin = admin
  }

  async disconnect(): Promise<void> {
    const admin = this.admin
    const consumers = [...this.consumers]
    this.admin = null
    this.client = null
    this.consumers.clear()
    // 활성 consumer를 먼저 정리하고(hub가 handle.stop으로 이미 했을 수 있으나
    // 백스톱), admin을 닫는다.
    await Promise.all(consumers.map((c) => c.disconnect().catch(() => {})))
    if (admin !== null) await admin.disconnect()
  }

  async ping(): Promise<number> {
    const admin = this.requireAdmin()
    const start = performance.now()
    await admin.listTopics()
    return performance.now() - start
  }

  requireAdmin(): KafkaAdminLike {
    if (this.admin === null) throw new Error(`kafka driver ${this.id} is not connected`)
    return this.admin
  }

  newConsumer(): KafkaConsumerLike {
    if (this.client === null) throw new Error(`kafka driver ${this.id} is not connected`)
    return this.client.consumer({ groupId: this.nextGroupId() })
  }

  nextGroupId(): string {
    return `datacon-tail-${this.randomId()}`
  }
}
