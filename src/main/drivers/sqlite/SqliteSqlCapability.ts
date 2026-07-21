import { buildResultSet, type PageRequest, type ResultSet } from '../../../shared/types/resultSet'
import type { ExecutionContext } from '../../core/driver/ExecutionContext'
import type {
  ReadOnlyScope,
  SqlCapability,
  StatementClassification,
} from '../../core/driver/capabilities/SqlCapability'
import { classifyStatement } from '../../core/execution/StatementClassifier'
import { sqliteValueMap } from './sqliteValueMap'
import type { DatabaseInstance } from './SqliteDriver'

const CURSOR_PREFIX = 'sqlite:1:'

function encodeCursor(statement: string, offset: number): string {
  return `${CURSOR_PREFIX}${offset}:${statement}`
}
function decodeCursor(cursor: string, statement: string): number {
  if (!cursor.startsWith(CURSOR_PREFIX)) throw new Error(`malformed cursor: ${cursor}`)
  const body = cursor.slice(CURSOR_PREFIX.length)
  const sep = body.indexOf(':')
  if (sep < 0) throw new Error(`malformed cursor: ${cursor}`)
  const offset = Number(body.slice(0, sep))
  if (!Number.isInteger(offset) || offset < 0) throw new Error(`malformed cursor: ${cursor}`)
  const owner = body.slice(sep + 1)
  if (owner !== statement) throw new Error('cursor belongs to a different statement')
  return offset
}

/** better-sqlite3 Statement의 우리가 쓰는 최소 표면. */
interface StmtLike {
  reader: boolean
  columns(): { name: string; type: string | null }[]
  raw(toggle?: boolean): StmtLike
  all(...params: unknown[]): unknown[]
  run(...params: unknown[]): { changes: number }
}

export class SqliteSqlCapability implements SqlCapability {
  constructor(private readonly getDb: () => DatabaseInstance) {}

  async execute(
    ctx: ExecutionContext,
    sql: string,
    page: PageRequest,
    params?: readonly unknown[],
  ): Promise<ResultSet> {
    return this.executeOn(this.getDb(), ctx, sql, page, params)
  }

  /**
   * `execute`의 본문. db를 인자로 받아 beginReadOnly가 연 범위에서도 같은 실행
   * 배선을 재사용한다(Postgres 드라이버와 같은 구조).
   */
  private async executeOn(
    db: DatabaseInstance,
    ctx: ExecutionContext,
    sql: string,
    page: PageRequest,
    params?: readonly unknown[],
  ): Promise<ResultSet> {
    if (ctx.signal.aborted) throw new Error(`execution aborted: ${ctx.requestId}`)
    const start = performance.now()
    const bind = params === undefined ? [] : [...params]
    const stmt = db.prepare(sql) as unknown as StmtLike

    if (!stmt.reader) {
      // INSERT/UPDATE/DELETE 등 — 행을 돌려주지 않는다. query_only가 켜져 있으면 여기서 던진다.
      const info = stmt.run(...bind)
      return buildResultSet({
        requestId: ctx.requestId,
        columns: [],
        rows: [],
        page,
        durationMs: performance.now() - start,
        cursorAt: () => null,
        rowsAffected: info.changes,
      })
    }

    const columns = stmt.columns().map((c) => ({ name: c.name, type: c.type ?? '' }))
    const offset = page.cursor === null ? 0 : decodeCursor(page.cursor, sql)
    const allRows = stmt.raw(true).all(...bind) as unknown[][]
    const total = allRows.length
    const rows = allRows.slice(offset).map((row) => row.map(sqliteValueMap))

    return buildResultSet({
      requestId: ctx.requestId,
      columns,
      rows,
      page,
      durationMs: performance.now() - start,
      cursorAt: (kept) => (offset + kept < total ? encodeCursor(sql, offset + kept) : null),
    })
  }

  async beginReadOnly(ctx: ExecutionContext): Promise<ReadOnlyScope> {
    if (ctx.signal.aborted) throw new Error(`execution aborted: ${ctx.requestId}`)
    const db = this.getDb()
    db.pragma('query_only = ON')
    return {
      execute: (scopeCtx: ExecutionContext, sql: string, page: PageRequest, params?: readonly unknown[]) =>
        this.executeOn(db, scopeCtx, sql, page, params),
      end: async () => {
        db.pragma('query_only = OFF')
      },
    }
  }

  classify(sql: string): StatementClassification {
    return classifyStatement(sql)
  }
}
