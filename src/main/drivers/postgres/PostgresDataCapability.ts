import type { BrowseSort, RowChange } from '../../../shared/types/operation'
import type { WireValue } from '../../../shared/types/wire'
import type {
  ApplyResult,
  BuiltStatement,
  DataCapability,
} from '../../core/driver/capabilities/DataCapability'
import type { ExecutionContext } from '../../core/driver/ExecutionContext'
import type { PgClientLike } from './PostgresDriver'

/** PostgreSQL 식별자 인용. 내부 큰따옴표는 이중화한다 — 인젝션 방지의 핵심. */
function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}

/** WireValue를 파라미터 바인딩 값으로 — null은 SQL NULL, 그 외는 내부 v. */
function paramOf(wv: WireValue): unknown {
  return wv.t === 'null' ? null : wv.v
}

/** 편집 한 건을 파라미터화 문장으로 조립한다. 값은 전부 $N 바인딩. */
function buildStatement(schema: string, table: string, change: RowChange): BuiltStatement {
  const target = `${quoteIdent(schema)}.${quoteIdent(table)}`
  if (change.op === 'insert') {
    const cols = Object.keys(change.values)
    const idents = cols.map(quoteIdent).join(', ')
    const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ')
    return {
      sql: `INSERT INTO ${target} (${idents}) VALUES (${placeholders})`,
      params: cols.map((c) => paramOf(change.values[c] as WireValue)),
    }
  }
  if (change.op === 'update') {
    const setCols = Object.keys(change.set)
    const pkCols = Object.keys(change.pk)
    const setClause = setCols.map((c, i) => `${quoteIdent(c)} = $${i + 1}`).join(', ')
    const whereClause = pkCols
      .map((c, i) => `${quoteIdent(c)} = $${setCols.length + i + 1}`)
      .join(' AND ')
    return {
      sql: `UPDATE ${target} SET ${setClause} WHERE ${whereClause}`,
      params: [
        ...setCols.map((c) => paramOf(change.set[c] as WireValue)),
        ...pkCols.map((c) => paramOf(change.pk[c] as WireValue)),
      ],
    }
  }
  // delete
  const pkCols = Object.keys(change.pk)
  const whereClause = pkCols.map((c, i) => `${quoteIdent(c)} = $${i + 1}`).join(' AND ')
  return {
    sql: `DELETE FROM ${target} WHERE ${whereClause}`,
    params: pkCols.map((c) => paramOf(change.pk[c] as WireValue)),
  }
}

export class PostgresDataCapability implements DataCapability {
  constructor(private readonly getConn: () => PgClientLike) {}

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
    const conn = this.getConn()
    await conn.query({ text: 'BEGIN' })
    try {
      let affected = 0
      for (const change of changes) {
        const { sql, params } = buildStatement(schema, table, change)
        const res = await conn.query({ text: sql, values: params })
        affected += res.rowCount ?? 0
      }
      await conn.query({ text: 'COMMIT' })
      return { affected }
    } catch (e) {
      // 단일 커넥션 드라이버 — 실패한 트랜잭션을 되돌리지 않으면 커넥션이
      // "aborted transaction"으로 갇혀 이후 모든 실행이 막힌다.
      await conn.query({ text: 'ROLLBACK' }).catch(() => {})
      throw e
    }
  }
}
