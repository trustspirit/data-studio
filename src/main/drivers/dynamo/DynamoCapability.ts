import { buildResultSet, type PageRequest, type ResultSet } from '@shared/types/resultSet'
import { wire, type WireValue } from '@shared/types/wire'
import type { ExecutionContext } from '@main/core/driver/ExecutionContext'
import type {
  DynamoCapability,
  DynamoScanReq,
  DynamoPartiqlReq,
} from '@main/core/driver/capabilities/DynamoCapability'
import type { DynamoClientLike } from './DynamoDriver'
import { isReadOnlyStatement } from './dynamoStatement'
import { normalizeItem } from './dynamoItem'

const TABLE_COLUMNS = [{ name: 'table', type: 'str' }]
const ITEM_COLUMNS = [{ name: '_item', type: 'json' }]
const TABLE_CURSOR_PREFIX = 'dynamo:tables:1:'
const KEY_CURSOR_PREFIX = 'dynamo:key:1:'
const TOKEN_CURSOR_PREFIX = 'dynamo:token:1:'

function checkAborted(ctx: ExecutionContext): void {
  if (ctx.signal.aborted) throw new Error(`execution aborted: ${ctx.requestId}`)
}

/** 불투명 배치 커서를 base64(JSON)로 왕복한다. DynamoDB의 LastEvaluatedKey/
 *  NextToken/LastEvaluatedTableName은 오프셋이 아니라 불투명 값이라, 그대로 실어
 *  다음 요청에 되돌려준다. */
function encode(prefix: string, value: unknown): string {
  return prefix + Buffer.from(JSON.stringify(value), 'utf8').toString('base64')
}
function decode(prefix: string, cursor: string): unknown {
  if (!cursor.startsWith(prefix)) throw new Error(`malformed cursor: ${cursor}`)
  return JSON.parse(Buffer.from(cursor.slice(prefix.length), 'base64').toString('utf8'))
}

function unmarshallItems(
  unmarshall: (m: Record<string, unknown>) => unknown,
  items: Record<string, unknown>[],
): (readonly WireValue[])[] {
  return items.map((raw) => [wire.json(JSON.stringify(normalizeItem(unmarshall(raw))))])
}

/**
 * DynamoDB 와이드컬럼 능력. v1은 읽기 전용(listTables/scan/partiql).
 *
 * scan/partiql은 DynamoDB의 불투명 커서(LastEvaluatedKey/NextToken)로 페이지네이션
 * 한다 — Redis SCAN처럼 배치 통째로 한 페이지다. 커서가 오프셋이 아니라 배치를
 * 부분 절단하면 이어읽기가 불가능하므로, maxBytes 상한이 배치를 잘랐다면
 * (cursorAt의 index < rows.length) 조용히 잃는 대신 명시적으로 던진다.
 */
export class DynamoCapabilityImpl implements DynamoCapability {
  constructor(
    private readonly getClient: () => DynamoClientLike,
    private readonly unmarshall: (m: Record<string, unknown>) => unknown,
  ) {}

  isReadOnlyStatement(statement: string): boolean {
    return isReadOnlyStatement(statement)
  }

  async listTables(ctx: ExecutionContext, page: PageRequest): Promise<ResultSet> {
    checkAborted(ctx)
    const start = performance.now()
    const client = this.getClient()
    const startName = page.cursor === null ? undefined : (decode(TABLE_CURSOR_PREFIX, page.cursor) as string)
    const out = await client.listTables({
      Limit: page.maxRows,
      ...(startName === undefined ? {} : { ExclusiveStartTableName: startName }),
    })
    const names = out.TableNames ?? []
    const rows = names.map((n) => [wire.str(n)] as const)
    const next = out.LastEvaluatedTableName
    return buildResultSet({
      requestId: ctx.requestId,
      columns: TABLE_COLUMNS,
      rows,
      page: { ...page, maxRows: Math.max(page.maxRows, rows.length) },
      durationMs: performance.now() - start,
      cursorAt: (index) => {
        if (index < rows.length) throw new Error('listTables batch exceeded byte limit; cannot resume mid-batch — raise maxBytes')
        return next === undefined ? null : encode(TABLE_CURSOR_PREFIX, next)
      },
    })
  }

  async scan(ctx: ExecutionContext, req: DynamoScanReq, page: PageRequest): Promise<ResultSet> {
    checkAborted(ctx)
    const start = performance.now()
    const client = this.getClient()
    const startKey = page.cursor === null ? undefined : (decode(KEY_CURSOR_PREFIX, page.cursor) as Record<string, unknown>)
    const out = await client.scan({
      TableName: req.table,
      Limit: page.maxRows,
      ...(startKey === undefined ? {} : { ExclusiveStartKey: startKey }),
    })
    const rows = unmarshallItems(this.unmarshall, out.Items ?? [])
    const next = out.LastEvaluatedKey
    return buildResultSet({
      requestId: ctx.requestId,
      columns: ITEM_COLUMNS,
      rows,
      page: { ...page, maxRows: Math.max(page.maxRows, rows.length) },
      durationMs: performance.now() - start,
      cursorAt: (index) => {
        if (index < rows.length) throw new Error('scan batch exceeded byte limit; DynamoDB cursor cannot resume mid-batch — raise maxBytes')
        return next === undefined ? null : encode(KEY_CURSOR_PREFIX, next)
      },
    })
  }

  async partiql(ctx: ExecutionContext, req: DynamoPartiqlReq, page: PageRequest): Promise<ResultSet> {
    checkAborted(ctx)
    // executor 관문이 이미 검증하지만 방어적으로 재확인한다(defense in depth).
    if (!isReadOnlyStatement(req.statement)) {
      throw new Error('PartiQL statement is not read-only (only SELECT allowed in v1)')
    }
    const start = performance.now()
    const client = this.getClient()
    const token = page.cursor === null ? undefined : (decode(TOKEN_CURSOR_PREFIX, page.cursor) as string)
    const out = await client.executeStatement({
      Statement: req.statement,
      ...(token === undefined ? {} : { NextToken: token }),
    })
    const rows = unmarshallItems(this.unmarshall, out.Items ?? [])
    const next = out.NextToken
    return buildResultSet({
      requestId: ctx.requestId,
      columns: ITEM_COLUMNS,
      rows,
      page: { ...page, maxRows: Math.max(page.maxRows, rows.length) },
      durationMs: performance.now() - start,
      cursorAt: (index) => {
        if (index < rows.length) throw new Error('partiql batch exceeded byte limit; NextToken cannot resume mid-batch — raise maxBytes')
        return next === undefined ? null : encode(TOKEN_CURSOR_PREFIX, next)
      },
    })
  }
}
