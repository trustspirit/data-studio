import { buildResultSet, type PageRequest, type ResultSet } from '../../../shared/types/resultSet'
import type { ExecutionContext } from '../../core/driver/ExecutionContext'
import type { SqlCapability, StatementClassification } from '../../core/driver/capabilities/SqlCapability'
import { classifyStatement } from '../../core/execution/StatementClassifier'
import { mapPgValue } from './pgTypeMap'
import type { PgClientLike } from './PostgresDriver'

const CURSOR_PREFIX = 'pg:1:'

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
  constructor(private readonly getConn: () => PgClientLike) {}

  async execute(
    ctx: ExecutionContext,
    sql: string,
    page: PageRequest,
    params?: readonly unknown[],
  ): Promise<ResultSet> {
    if (ctx.signal.aborted) throw new Error(`execution aborted: ${ctx.requestId}`)
    const conn = this.getConn()
    const start = performance.now()

    // offset 기반: 전체를 읽고 offset부터 buildResultSet에 넘긴다. (keyset은 UI 슬라이스에서.)
    const offset = page.cursor === null ? 0 : decodeCursor(page.cursor, sql)
    const result = await conn.query({
      text: sql,
      ...(params === undefined ? {} : { values: params }),
      rowMode: 'array',
    })

    const columns = result.fields.map((f) => ({ name: f.name, type: String(f.dataTypeID) }))
    const rawRows = (result.rows as unknown[][]).slice(offset)
    const rows = rawRows.map((row) =>
      row.map((value, i) => mapPgValue(result.fields[i]?.dataTypeID ?? 0, value)),
    )

    const isWrite = !NO_ROWS_COMMANDS.has(result.command)
    const total = (result.rows as unknown[][]).length

    return buildResultSet({
      requestId: ctx.requestId,
      columns,
      rows,
      page,
      durationMs: performance.now() - start,
      cursorAt: (kept) => (offset + kept < total ? encodeCursor(sql, offset + kept) : null),
      ...(isWrite ? { rowsAffected: result.rowCount ?? null } : {}),
    })
  }

  classify(sql: string): StatementClassification {
    // 코어 분류기(모든 방언 최엄격)에 위임한다 — 규칙을 재구현하지 않는다.
    return classifyStatement(sql)
  }
}
