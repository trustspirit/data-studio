import type { BrowseSort, RowChange } from '../../../shared/types/operation'
import type { WireValue } from '../../../shared/types/wire'
import type {
  ApplyResult,
  BuiltStatement,
  DataCapability,
} from '../../core/driver/capabilities/DataCapability'
import type { ExecutionContext } from '../../core/driver/ExecutionContext'
import type { DatabaseInstance } from './SqliteDriver'

/** SQLite 식별자 인용. 내부 큰따옴표 이중화 — 인젝션 방지. */
function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}

/**
 * WireValue를 better-sqlite3 바인딩 값으로. better-sqlite3는 숫자·문자열·bigint·
 * Buffer·null만 받고 JS boolean에 던진다 — bool만 1/0으로 바꾸고 나머지는 v를 그대로.
 */
function paramOf(wv: WireValue): unknown {
  if (wv.t === 'null') return null
  if (wv.t === 'bool') return wv.v ? 1 : 0
  return wv.v
}

/** 편집 한 건을 `?` 파라미터화 문장으로 조립한다. */
function buildStatement(schema: string, table: string, change: RowChange): BuiltStatement {
  const target = `${quoteIdent(schema)}.${quoteIdent(table)}`
  if (change.op === 'insert') {
    const cols = Object.keys(change.values)
    const idents = cols.map(quoteIdent).join(', ')
    const placeholders = cols.map(() => '?').join(', ')
    return {
      sql: `INSERT INTO ${target} (${idents}) VALUES (${placeholders})`,
      params: cols.map((c) => paramOf(change.values[c] as WireValue)),
    }
  }
  if (change.op === 'update') {
    const setCols = Object.keys(change.set)
    const pkCols = Object.keys(change.pk)
    const setClause = setCols.map((c) => `${quoteIdent(c)} = ?`).join(', ')
    const whereClause = pkCols.map((c) => `${quoteIdent(c)} = ?`).join(' AND ')
    return {
      sql: `UPDATE ${target} SET ${setClause} WHERE ${whereClause}`,
      params: [
        ...setCols.map((c) => paramOf(change.set[c] as WireValue)),
        ...pkCols.map((c) => paramOf(change.pk[c] as WireValue)),
      ],
    }
  }
  const pkCols = Object.keys(change.pk)
  const whereClause = pkCols.map((c) => `${quoteIdent(c)} = ?`).join(' AND ')
  return {
    sql: `DELETE FROM ${target} WHERE ${whereClause}`,
    params: pkCols.map((c) => paramOf(change.pk[c] as WireValue)),
  }
}

/** better-sqlite3 Statement의 run 표면만. */
interface RunStmt {
  run(...params: unknown[]): { changes: number }
}

export class SqliteDataCapability implements DataCapability {
  constructor(private readonly getDb: () => DatabaseInstance) {}

  buildBrowse(schema: string, table: string, sort?: BrowseSort): BuiltStatement {
    const target = `${quoteIdent(schema)}.${quoteIdent(table)}`
    const order =
      sort === undefined
        ? ''
        : ` ORDER BY ${quoteIdent(sort.column)} ${sort.direction === 'desc' ? 'DESC' : 'ASC'}`
    return { sql: `SELECT * FROM ${target}${order}`, params: [] }
  }

  async applyChanges(
    ctx: ExecutionContext,
    schema: string,
    table: string,
    changes: readonly RowChange[],
  ): Promise<ApplyResult> {
    if (ctx.signal.aborted) throw new Error(`execution aborted: ${ctx.requestId}`)
    const db = this.getDb()
    let affected = 0
    // better-sqlite3의 transaction()은 콜백이 throw하면 자동 롤백한다(동기).
    const tx = db.transaction((list: readonly RowChange[]) => {
      for (const change of list) {
        const { sql, params } = buildStatement(schema, table, change)
        const info = (db.prepare(sql) as unknown as RunStmt).run(...params)
        affected += info.changes
      }
    })
    tx(changes)
    return { affected }
  }
}
