import type { BrowseSort, RowChange } from '../../../shared/types/operation'
import type { WireValue } from '../../../shared/types/wire'
import type {
  ApplyResult,
  BuiltStatement,
  DataCapability,
} from '../../core/driver/capabilities/DataCapability'
import type { ExecutionContext } from '../../core/driver/ExecutionContext'
import type { MysqlClientLike } from './MysqlDriver'

/** MySQL/MariaDB 식별자 인용. 내부 백틱은 이중화한다 — 인젝션 방지의 핵심. */
function quoteIdent(name: string): string {
  return '`' + name.replace(/`/g, '``') + '`'
}

/**
 * WireValue를 mysql2 바인딩 값으로. mysql2는 JS boolean을 그대로 바인딩하면
 * 드라이버 버전에 따라 안전하지 않게 취급할 수 있다(SqliteDataCapability와 동일한
 * 이유) — bool만 1/0으로 바꾸고 나머지는 v를 그대로.
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
  // delete
  const pkCols = Object.keys(change.pk)
  const whereClause = pkCols.map((c) => `${quoteIdent(c)} = ?`).join(' AND ')
  return {
    sql: `DELETE FROM ${target} WHERE ${whereClause}`,
    params: pkCols.map((c) => paramOf(change.pk[c] as WireValue)),
  }
}

export class MysqlDataCapability implements DataCapability {
  constructor(private readonly getConn: () => MysqlClientLike) {}

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
    await conn.beginTransaction()
    try {
      let affected = 0
      for (const change of changes) {
        const { sql, params } = buildStatement(schema, table, change)
        const [res] = await conn.query(sql, params)
        affected += (res as { affectedRows?: number }).affectedRows ?? 0
      }
      await conn.commit()
      return { affected }
    } catch (e) {
      // 단일 커넥션 드라이버 — 실패한 트랜잭션을 되돌리지 않으면 이후 실행이
      // 잘못된 상태 위에서 이어진다. rollback 자체의 실패는 원래 에러를 가리므로 삼킨다.
      await conn.rollback().catch(() => {})
      throw e instanceof Error ? e : new Error(String(e))
    }
  }
}
