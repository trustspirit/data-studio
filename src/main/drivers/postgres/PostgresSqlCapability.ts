import { buildResultSet, type PageRequest, type ResultSet } from '../../../shared/types/resultSet'
import type { ExecutionContext } from '../../core/driver/ExecutionContext'
import type {
  ReadOnlyScope,
  SqlCapability,
  StatementClassification,
} from '../../core/driver/capabilities/SqlCapability'
import { classifyStatement } from '../../core/execution/StatementClassifier'
import { mapPgValue } from './pgTypeMap'
import type { PgClientLike } from './PostgresDriver'

const CURSOR_PREFIX = 'pg:1:'

/** RO 범위 안에서만 걸리는 statement_timeout. 실행 제한 연동은 OperationExecutor 몫이며
 *  이 슬라이스에서는 인터페이스 변경 없이 상수로 둔다. */
const READ_ONLY_TIMEOUT_MS = 30_000

function decodeCursor(cursor: string, statement: string): number {
  if (!cursor.startsWith(CURSOR_PREFIX)) throw new Error(`malformed cursor: ${cursor}`)
  const body = cursor.slice(CURSOR_PREFIX.length)
  const sep = body.indexOf(':')
  if (sep < 0) throw new Error(`malformed cursor: ${cursor}`)
  const offset = Number(body.slice(0, sep))
  if (!Number.isInteger(offset) || offset < 0) throw new Error(`malformed cursor: ${cursor}`)
  const owner = body.slice(sep + 1)
  if (owner !== statement) throw new Error(`cursor belongs to a different statement`)
  return offset
}

function encodeCursor(statement: string, offset: number): string {
  return `${CURSOR_PREFIX}${offset}:${statement}`
}

/** SELECT가 아닌 명령은 rowsAffected를 보고한다. */
const NO_ROWS_COMMANDS = new Set(['SELECT', 'SHOW', 'EXPLAIN'])

export class PostgresSqlCapability implements SqlCapability {
  constructor(
    private readonly getConn: () => PgClientLike,
    private readonly cancel: () => Promise<void>,
  ) {}

  async execute(
    ctx: ExecutionContext,
    sql: string,
    page: PageRequest,
    params?: readonly unknown[],
  ): Promise<ResultSet> {
    return this.executeOn(this.getConn(), ctx, sql, page, params)
  }

  /**
   * `execute`의 본문. 커넥션을 인자로 받아, `beginReadOnly`가 연 RO 트랜잭션의
   * 커넥션에서도 같은 실행/취소 배선을 재사용할 수 있게 한다.
   */
  private async executeOn(
    conn: PgClientLike,
    ctx: ExecutionContext,
    sql: string,
    page: PageRequest,
    params?: readonly unknown[],
  ): Promise<ResultSet> {
    if (ctx.signal.aborted) throw new Error(`execution aborted: ${ctx.requestId}`)
    const start = performance.now()

    // offset 기반: 전체를 읽고 offset부터 buildResultSet에 넘긴다. (keyset은 UI 슬라이스에서.)
    const offset = page.cursor === null ? 0 : decodeCursor(page.cursor, sql)

    const queryPromise = conn.query({
      text: sql,
      ...(params === undefined ? {} : { values: params }),
      rowMode: 'array',
    })

    const onAbort = (): void => {
      void this.cancel()
    }
    if (ctx.signal.aborted) onAbort()
    else ctx.signal.addEventListener('abort', onAbort, { once: true })

    let result
    try {
      // 취소를 보내도 주 쿼리는 취소 에러로 "끝난다" — 그 종료를 기다린다.
      // 이렇게 해야 백엔드가 조용해진 뒤에 커넥션을 반납한다(quiescent).
      result = await queryPromise
    } finally {
      ctx.signal.removeEventListener('abort', onAbort)
    }

    const columns = result.fields.map((f) => ({ name: f.name, type: String(f.dataTypeID) }))
    const rawRows = (result.rows as unknown[][]).slice(offset)
    const rows = rawRows.map((row) =>
      row.map((value, i) => mapPgValue(result.fields[i]?.dataTypeID ?? 0, value)),
    )

    const isWrite = !NO_ROWS_COMMANDS.has(result.command)
    const total = (result.rows as unknown[][]).length

    // 쓰기 문장(INSERT/UPDATE/DELETE ... RETURNING 포함)은 커서를 내지 않는다.
    // execute는 커서를 받으면 statement 전체를 재실행하므로, 쓰기에 커서를
    // 내주면 상위 레이어가 다음 페이지를 읽으려다 쓰기를 다시 실행해
    // (예: `SET n = n + 1`) 결과를 이중으로 반영하게 된다.
    const cursorAt = isWrite
      ? () => null
      : (kept: number) => (offset + kept < total ? encodeCursor(sql, offset + kept) : null)

    return buildResultSet({
      requestId: ctx.requestId,
      columns,
      rows,
      page,
      durationMs: performance.now() - start,
      cursorAt,
      ...(isWrite ? { rowsAffected: result.rowCount ?? null } : {}),
    })
  }

  async beginReadOnly(ctx: ExecutionContext): Promise<ReadOnlyScope> {
    if (ctx.signal.aborted) throw new Error(`execution aborted: ${ctx.requestId}`)
    const conn = this.getConn()
    await conn.query({ text: 'BEGIN TRANSACTION READ ONLY' })
    try {
      // RO 범위 안에서만 걸리는 timeout.
      await conn.query({ text: `SET LOCAL statement_timeout = ${READ_ONLY_TIMEOUT_MS}` })
    } catch (e) {
      // 이 드라이버는 커넥션을 풀링하지 않는다 — BEGIN 이후 실패를 그냥 던지면
      // 이 커넥션은 "aborted transaction" 상태로 갇혀 이후 모든 실행(RO scope뿐
      // 아니라 일반 execute까지)이 막힌다. 설정 실패 시 트랜잭션을 되돌려
      // 커넥션을 다시 쓸 수 있게 한다.
      await conn.query({ text: 'ROLLBACK' }).catch(() => {})
      throw e
    }

    return {
      execute: (scopeCtx: ExecutionContext, sql: string, page: PageRequest, params?: readonly unknown[]) =>
        this.executeOn(conn, scopeCtx, sql, page, params),
      end: async () => {
        await conn.query({ text: 'COMMIT' })
      },
    }
  }

  classify(sql: string): StatementClassification {
    // 코어 분류기(모든 방언 최엄격)에 위임한다 — 규칙을 재구현하지 않는다.
    return classifyStatement(sql)
  }
}
