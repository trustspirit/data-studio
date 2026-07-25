import {
  DynamoDBClient,
  ListTablesCommand,
  ScanCommand,
  ExecuteStatementCommand,
  type AttributeValue,
} from '@aws-sdk/client-dynamodb'
import { unmarshall } from '@aws-sdk/util-dynamodb'
import { fromNodeProviderChain } from '@aws-sdk/credential-providers'
import type { Driver } from '@main/core/driver/Driver'
import type { ConnectionConfig } from '@shared/types/connection'
import { buildDynamoConfig, type DynamoConnParams } from './dynamoConfig'
import { DynamoCapabilityImpl } from './DynamoCapability'

/**
 * DynamoDBClient에서 우리가 쓰는 최소 표면. 커맨드 클래스는 이 뒤에 감춰,
 * capability는 send/Command를 모른다. 테스트는 이 인터페이스를 fake로 대체한다.
 * Items는 marshalled AttributeValue 맵이며 capability가 unmarshall한다.
 */
export interface DynamoClientLike {
  listTables(input: { ExclusiveStartTableName?: string; Limit?: number }): Promise<{
    TableNames?: string[] | undefined
    LastEvaluatedTableName?: string | undefined
  }>
  scan(input: { TableName: string; ExclusiveStartKey?: Record<string, unknown>; Limit?: number }): Promise<{
    Items?: Record<string, unknown>[] | undefined
    LastEvaluatedKey?: Record<string, unknown> | undefined
  }>
  executeStatement(input: { Statement: string; NextToken?: string }): Promise<{
    Items?: Record<string, unknown>[] | undefined
    NextToken?: string | undefined
  }>
  destroy(): void
}

export interface DynamoDriverDeps {
  getPassword: () => Promise<string | null>
  createClient?: (params: DynamoConnParams) => DynamoClientLike
}

export class DynamoConnectionIdentityError extends Error {
  constructor(driverId: string, configId: string) {
    super(`config id ${configId} does not match driver id ${driverId}`)
    this.name = 'DynamoConnectionIdentityError'
  }
}

function defaultCreateClient(params: DynamoConnParams): DynamoClientLike {
  const client = new DynamoDBClient({
    region: params.region,
    ...(params.endpoint === undefined ? {} : { endpoint: params.endpoint }),
    // username이 없으면(정적 자격증명 없음) SDK 기본 provider chain에 위임한다 —
    // env/AWS_PROFILE/SSO 캐시/EC2·ECS 역할을 SDK가 알아서 해석한다.
    credentials: params.credentials ?? fromNodeProviderChain(),
  })
  return {
    listTables: (input) => client.send(new ListTablesCommand(input)),
    // ExclusiveStartKey는 우리 쪽에서 opaque 값으로 다룬다(항상 DynamoDB 자신의
    // LastEvaluatedKey를 그대로 되돌려 보낸 것) — AttributeValue 맵으로 캐스트한다.
    scan: (input) =>
      client.send(
        new ScanCommand({
          ...input,
          ExclusiveStartKey: input.ExclusiveStartKey as Record<string, AttributeValue> | undefined,
        }),
      ),
    executeStatement: (input) => client.send(new ExecuteStatementCommand(input)),
    destroy: () => client.destroy(),
  }
}

/**
 * DynamoDB 드라이버. DynamoDB는 stateless HTTP라 지속 소켓을 열지 않는다 —
 * connect는 클라이언트 인스턴스를 준비하고, ping은 listTables 왕복으로 자격증명/
 * 리전/엔드포인트 생존성을 확인한다.
 */
export class DynamoDriver implements Driver {
  readonly id: string
  readonly engine = 'dynamodb' as const
  private client: DynamoClientLike | null = null
  readonly dynamo: DynamoCapabilityImpl

  constructor(
    config: ConnectionConfig,
    private readonly deps: DynamoDriverDeps,
  ) {
    this.id = config.id
    this.dynamo = new DynamoCapabilityImpl(
      () => this.requireClient(),
      (m) => unmarshall(m as Parameters<typeof unmarshall>[0]),
    )
  }

  async connect(config: ConnectionConfig): Promise<void> {
    if (config.id !== this.id) throw new DynamoConnectionIdentityError(this.id, config.id)
    const secret = await this.deps.getPassword()
    const params = buildDynamoConfig(config, secret)
    const create = this.deps.createClient ?? defaultCreateClient
    this.client = create(params)
  }

  async disconnect(): Promise<void> {
    const c = this.client
    this.client = null
    if (c !== null) c.destroy()
  }

  async ping(): Promise<number> {
    const client = this.requireClient()
    const start = performance.now()
    await client.listTables({ Limit: 1 })
    return performance.now() - start
  }

  requireClient(): DynamoClientLike {
    if (this.client === null) throw new Error(`dynamo driver ${this.id} is not connected`)
    return this.client
  }
}
