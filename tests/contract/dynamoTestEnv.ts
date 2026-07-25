import {
  DynamoDBClient,
  CreateTableCommand,
  DeleteTableCommand,
  PutItemCommand,
  ListTablesCommand,
  waitUntilTableExists,
} from '@aws-sdk/client-dynamodb'
import { marshall } from '@aws-sdk/util-dynamodb'
import { randomUUID } from 'node:crypto'

export const DYNAMO_HOST = process.env.DATACON_TEST_DYNAMO_HOST ?? 'localhost'
export const DYNAMO_ENDPOINT = `http://${DYNAMO_HOST}:8000`
export const DYNAMO_REGION = 'us-east-1'
// DynamoDB Local은 자격증명을 무시하지만, SDK는 존재를 요구한다.
export const DYNAMO_CREDS = { accessKeyId: 'fake', secretAccessKey: 'fake' }

function newClient(): DynamoDBClient {
  return new DynamoDBClient({ region: DYNAMO_REGION, endpoint: DYNAMO_ENDPOINT, credentials: DYNAMO_CREDS })
}

async function probe(): Promise<boolean> {
  const client = newClient()
  try {
    await client.send(new ListTablesCommand({ Limit: 1 }))
    return true
  } catch {
    return false
  } finally {
    client.destroy()
  }
}

export const DYNAMO_AVAILABLE: boolean = await probe()

/**
 * uuid 이름의 테이블을 pk(문자열 파티션 키)로 만들고, seed 아이템을 넣고,
 * fn(tableName, client)을 부른다. 끝나면 테이블을 삭제한다.
 */
export async function withTable(
  seed: readonly Record<string, unknown>[],
  fn: (table: string, client: DynamoDBClient) => Promise<void>,
): Promise<void> {
  const table = `t_${randomUUID().replace(/-/g, '').slice(0, 16)}`
  const client = newClient()
  try {
    await client.send(new CreateTableCommand({
      TableName: table,
      AttributeDefinitions: [{ AttributeName: 'pk', AttributeType: 'S' }],
      KeySchema: [{ AttributeName: 'pk', KeyType: 'HASH' }],
      BillingMode: 'PAY_PER_REQUEST',
    }))
    // DynamoDB Local은 테이블을 거의 즉시 ACTIVE로 만든다. 이 SDK 버전의
    // waitUntilTableExists 기본 minDelay(20s)가 maxWaitTime보다 커서 그대로
    // 쓰면 검증 에러가 나므로, minDelay를 짧게 오버라이드한다.
    await waitUntilTableExists({ client, maxWaitTime: 15, minDelay: 1, maxDelay: 2 }, { TableName: table })
    for (const item of seed) {
      await client.send(new PutItemCommand({ TableName: table, Item: marshall(item) }))
    }
    await fn(table, client)
  } finally {
    try {
      await client.send(new DeleteTableCommand({ TableName: table }))
    } finally {
      client.destroy()
    }
  }
}
