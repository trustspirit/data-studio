import { buildResultSet, type PageRequest, type ResultSet } from '@shared/types/resultSet'
import { wire } from '@shared/types/wire'
import type { ExecutionContext } from '@main/core/driver/ExecutionContext'
import type {
  DocumentAggregateReq,
  DocumentCapability,
  DocumentFindReq,
} from '@main/core/driver/capabilities/DocumentCapability'
import type { MongoDbLike } from './MongoDriver'
import { docToWireJson, parseEjson } from './mongoEjson'

const CURSOR_PREFIX = 'mongo:1:'

/** 오프셋 커서를 인코딩한다. `key`는 이 요청을 식별하는 문자열(질의 자체)이다 —
 * 다른 질의/컬렉션에서 발급된 커서를 이어 읽으면 엉뚱한 데이터가 나가므로,
 * sqlite/postgres 드라이버와 같은 관용구로 커서에 질의를 함께 실어 검증한다. */
function encodeCursor(key: string, offset: number): string {
  return `${CURSOR_PREFIX}${offset}:${key}`
}

function decodeCursor(cursor: string, key: string): number {
  if (!cursor.startsWith(CURSOR_PREFIX)) throw new Error(`malformed cursor: ${cursor}`)
  const body = cursor.slice(CURSOR_PREFIX.length)
  const sep = body.indexOf(':')
  if (sep < 0) throw new Error(`malformed cursor: ${cursor}`)
  const offset = Number(body.slice(0, sep))
  if (!Number.isInteger(offset) || offset < 0) throw new Error(`malformed cursor: ${cursor}`)
  const owner = body.slice(sep + 1)
  if (owner !== key) throw new Error('cursor belongs to a different query')
  return offset
}

function checkAborted(ctx: ExecutionContext): void {
  if (ctx.signal.aborted) throw new Error(`execution aborted: ${ctx.requestId}`)
}

const DOC_COLUMNS = [{ name: '_doc', type: 'json' }]

/** 문서 배열 + 오프셋 커서 키로 `ResultSet`을 조립한다. find/aggregate가 공유한다. */
function buildDocResultSet(
  ctx: ExecutionContext,
  docs: readonly Record<string, unknown>[],
  page: PageRequest,
  cursorKey: string,
  durationMs: number,
): ResultSet {
  const offset = page.cursor === null ? 0 : decodeCursor(page.cursor, cursorKey)
  const total = docs.length
  const rows = docs.slice(offset).map((doc) => [docToWireJson(doc)])

  return buildResultSet({
    requestId: ctx.requestId,
    columns: DOC_COLUMNS,
    rows,
    page,
    durationMs,
    cursorAt: (kept) => (offset + kept < total ? encodeCursor(cursorKey, offset + kept) : null),
  })
}

/** EJSON 파이프라인 배열에서 쓰기 스테이지($out/$merge)를 찾는다. */
function findWriteStage(pipeline: unknown): boolean {
  if (!Array.isArray(pipeline)) return false
  return pipeline.some(
    (stage) => typeof stage === 'object' && stage !== null && ('$out' in stage || '$merge' in stage),
  )
}

/**
 * MongoDB 문서 능력. find/aggregate/listCollections 모두 읽기(v1)이며, 결과는
 * 한 행=문서 하나, `_doc` json 컬럼(EJSON canonical, BSON 무손실)에 담긴다.
 *
 * 커서 페이지네이션은 sqlite/postgres와 같은 "전체 읽기 후 오프셋 슬라이스"
 * 관용구다 — mongo 서버 커서(getMore)를 IPC 페이지 경계와 맞물리게 하는 대신,
 * `.toArray()`로 전체를 한 번에 읽고 `buildResultSet`이 byte/행 상한에 맞춰
 * 자른다. 대용량 컬렉션 스트리밍은 v1 범위 밖이다.
 */
export class MongoDocumentCapability implements DocumentCapability {
  constructor(private readonly getDb: () => MongoDbLike) {}

  async listCollections(ctx: ExecutionContext, page: PageRequest): Promise<ResultSet> {
    checkAborted(ctx)
    const start = performance.now()
    const db = this.getDb()
    const infos = await db.listCollections(undefined, { signal: ctx.signal }).toArray()
    const names = infos.map((info) => info.name).sort()

    const cursorKey = 'listCollections'
    const offset = page.cursor === null ? 0 : decodeCursor(page.cursor, cursorKey)
    const total = names.length
    const rows = names.slice(offset).map((name) => [wire.str(name)])

    return buildResultSet({
      requestId: ctx.requestId,
      columns: [{ name: 'name', type: 'str' }],
      rows,
      page,
      durationMs: performance.now() - start,
      cursorAt: (kept) => (offset + kept < total ? encodeCursor(cursorKey, offset + kept) : null),
    })
  }

  async find(ctx: ExecutionContext, req: DocumentFindReq, page: PageRequest): Promise<ResultSet> {
    checkAborted(ctx)
    const start = performance.now()
    const db = this.getDb()

    const filter = (req.filter === undefined ? {} : parseEjson(req.filter)) as Record<string, unknown>
    const sort = req.sort === undefined ? undefined : (parseEjson(req.sort) as Record<string, unknown>)
    // 음수/0 limit은 mongo find().limit(-n)에서 특수(함정) 의미를 갖는다(첫
    // 배치만 받고 커서를 닫음). 양의 정수일 때만 적용하고 그 외엔 무시한다.
    const limit = typeof req.limit === 'number' && req.limit > 0 ? req.limit : undefined

    const cursor = db.collection(req.collection).find(filter, {
      ...(sort === undefined ? {} : { sort }),
      ...(limit === undefined ? {} : { limit }),
      signal: ctx.signal,
    })
    const docs = await cursor.toArray()

    const cursorKey = `${req.collection}:${req.filter ?? ''}:${req.sort ?? ''}:${req.limit ?? ''}`
    return buildDocResultSet(ctx, docs, page, cursorKey, performance.now() - start)
  }

  async aggregate(ctx: ExecutionContext, req: DocumentAggregateReq, page: PageRequest): Promise<ResultSet> {
    checkAborted(ctx)
    // 실행기(DocumentCapabilityExecutor)가 이미 이 관문을 거치지만, 드라이버가
    // 다른 경로로 직접 호출될 가능성에 대비해 방어적으로 한 번 더 검사한다
    // (defense in depth) — $out/$merge는 v1의 읽기 전용 정책을 깬다.
    if (!this.isReadOnlyPipeline(req.pipeline)) {
      throw new Error('aggregate pipeline is not read-only ($out/$merge not allowed in v1)')
    }

    const start = performance.now()
    const db = this.getDb()
    const pipeline = parseEjson(req.pipeline) as Record<string, unknown>[]

    const cursor = db.collection(req.collection).aggregate(pipeline, { signal: ctx.signal })
    const docs = await cursor.toArray()

    const cursorKey = `${req.collection}:${req.pipeline}`
    return buildDocResultSet(ctx, docs, page, cursorKey, performance.now() - start)
  }

  isReadOnlyPipeline(pipeline: string): boolean {
    const parsed = parseEjson(pipeline)
    // fail closed: 파이프라인이 배열이 아니면 분석할 수 없으니 읽기 전용으로
    // 간주하지 않는다(서버는 배열 아닌 pipeline을 거부하지만, 방어적 관문은
    // 판단 불가 입력을 안전한 쪽으로 처리해야 한다).
    if (!Array.isArray(parsed)) return false
    return !findWriteStage(parsed)
  }
}
