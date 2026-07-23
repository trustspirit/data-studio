import { buildResultSet, type PageRequest, type ResultSet } from '@shared/types/resultSet'
import { wire } from '@shared/types/wire'
import type { ExecutionContext } from '@main/core/driver/ExecutionContext'
import type { KeyValueCapability, KeyScanReq } from '@main/core/driver/capabilities/KeyValueCapability'
import type { RedisClientLike } from './RedisDriver'
import { normalizeValue, type RedisRawValue } from './redisValue'

const CURSOR_PREFIX = 'redis:1:'
const DEFAULT_MATCH = '*'

/**
 * SCAN 커서를 인코딩한다. `match`를 함께 실어, 다른 패턴으로 발급된 커서를 이어
 * 읽으면 거부한다(mongo foreign-cursor 관용구 미러). SCAN 커서는 숫자 문자열이라
 * ':'을 포함하지 않으므로, 첫 ':' 앞을 커서, 뒤를 match로 안전하게 나눈다.
 */
function encodeCursor(scanCursor: string, match: string): string {
  return `${CURSOR_PREFIX}${scanCursor}:${match}`
}

function decodeCursor(cursor: string, match: string): string {
  if (!cursor.startsWith(CURSOR_PREFIX)) throw new Error(`malformed cursor: ${cursor}`)
  const body = cursor.slice(CURSOR_PREFIX.length)
  const sep = body.indexOf(':')
  if (sep < 0) throw new Error(`malformed cursor: ${cursor}`)
  const owner = body.slice(sep + 1)
  if (owner !== match) throw new Error('cursor belongs to a different scan')
  return body.slice(0, sep)
}

function checkAborted(ctx: ExecutionContext): void {
  if (ctx.signal.aborted) throw new Error(`execution aborted: ${ctx.requestId}`)
}

const SCAN_COLUMNS = [
  { name: 'key', type: 'str' },
  { name: 'type', type: 'str' },
  { name: 'ttl', type: 'int' },
]
const GET_COLUMNS = [
  { name: 'type', type: 'str' },
  { name: 'ttl', type: 'int' },
  { name: 'value', type: 'json' },
]

/** 타입별로 값을 읽어 정규화 가능한 raw로 돌려준다. stream/기타는 null. */
async function readRaw(client: RedisClientLike, key: string, type: string): Promise<RedisRawValue> {
  switch (type) {
    case 'string':
      return client.get(key)
    case 'list':
      return client.lrange(key, 0, -1)
    case 'set':
      return client.smembers(key)
    case 'hash':
      return client.hgetall(key)
    case 'zset':
      return client.zrange(key, 0, -1, 'WITHSCORES')
    default:
      return null
  }
}

/**
 * Redis 키-값 능력. v1은 읽기 전용(scan/get).
 *
 * scan은 Redis 네이티브 SCAN 커서로 페이지네이션한다 — mongo의 "전체 읽고 오프셋
 * 슬라이스"와 달리 SCAN 한 번이 곧 한 페이지다. SCAN 커서는 오프셋이 아니라
 * 불투명 값이라 행을 부분 절단하면 이어읽기가 불가능하므로, 배치를 통째로 담고
 * 다음 커서로 SCAN이 준 커서를 그대로 쓴다(키 메타데이터 행은 작아 byte 상한에
 * 걸릴 일이 없다).
 */
export class RedisKeyValueCapability implements KeyValueCapability {
  constructor(private readonly getClient: () => RedisClientLike) {}

  async scan(ctx: ExecutionContext, req: KeyScanReq, page: PageRequest): Promise<ResultSet> {
    checkAborted(ctx)
    const start = performance.now()
    const client = this.getClient()
    const match = req.match ?? DEFAULT_MATCH
    const scanCursor = page.cursor === null ? '0' : decodeCursor(page.cursor, match)

    const [nextCursor, keys] = await client.scan(scanCursor, 'MATCH', match, 'COUNT', page.maxRows)

    const rows = await Promise.all(
      keys.map(async (key) => {
        const [type, pttl] = await Promise.all([client.type(key), client.pttl(key)])
        return [wire.str(key), wire.str(type), wire.int(pttl)]
      }),
    )

    return buildResultSet({
      requestId: ctx.requestId,
      columns: SCAN_COLUMNS,
      rows,
      // SCAN 배치는 통째로 한 페이지다 — 행 절단으로 커서를 전진시킬 수 없으므로
      // maxRows로 자르지 않는다(SCAN 커서는 오프셋이 아니다). 다음 커서는 SCAN이
      // 준 nextCursor. maxBytes 보호는 유지된다(작은 행이라 실무상 미발동).
      page: { ...page, maxRows: Math.max(page.maxRows, rows.length) },
      durationMs: performance.now() - start,
      cursorAt: () => (nextCursor === '0' ? null : encodeCursor(nextCursor, match)),
    })
  }

  async get(ctx: ExecutionContext, key: string, page: PageRequest): Promise<ResultSet> {
    checkAborted(ctx)
    const start = performance.now()
    const client = this.getClient()

    const type = await client.type(key)
    if (type === 'none') {
      return buildResultSet({
        requestId: ctx.requestId,
        columns: GET_COLUMNS,
        rows: [],
        page,
        durationMs: performance.now() - start,
        cursorAt: () => null,
      })
    }

    const [pttl, raw] = await Promise.all([client.pttl(key), readRaw(client, key, type)])
    const normalized = normalizeValue(type, raw)
    const row = [wire.str(type), wire.int(pttl), wire.json(JSON.stringify(normalized))]

    return buildResultSet({
      requestId: ctx.requestId,
      columns: GET_COLUMNS,
      rows: [row],
      page,
      durationMs: performance.now() - start,
      cursorAt: () => null,
    })
  }
}
