import type { BrowseFilter, BrowseSort, RowChange } from '../../../shared/types/operation'
import { buildBrowseFilters } from '../../core/driver/capabilities/browseFilters'
import type { WireValue } from '../../../shared/types/wire'
import type {
  ApplyResult,
  BuiltStatement,
  DataCapability,
} from '../../core/driver/capabilities/DataCapability'
import type { ExecutionContext } from '../../core/driver/ExecutionContext'
import type { MysqlClientLike } from './MysqlDriver'
import { assertRowTouched } from '../../core/driver/capabilities/rowChangeGuard'

/** MySQL/MariaDB 식별자 인용. 내부 백틱은 이중화한다 — 인젝션 방지의 핵심. */
function quoteIdent(name: string): string {
  return '`' + name.replace(/`/g, '``') + '`'
}

/** 표준 base64(패딩 포함). `wire.bytes`가 내보내는 형태와 정확히 같다. */
const BASE64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

/**
 * bytes WireValue를 실제 바이트로 되돌린다.
 *
 * `wv.v`는 원본 바이트가 아니라 base64 **문자열**이다(`wire.bytes` 참고).
 * 그대로 바인딩하면 BLOB/BINARY 컬럼에 base64 ASCII가 저장되고, 이진 PK를
 * WHERE에 쓰면 어느 행과도 매칭되지 않은 채 성공(0행)으로 보고된다.
 * mysql2는 Buffer를 `X'...'` hex 리터럴로 이스케이프하므로 바이트가 보존된다.
 */
function bytesParam(wv: Extract<WireValue, { t: 'bytes' }>): Buffer {
  if (wv.truncated) {
    // 잘린 blob을 되쓰면 남은 바이트가 조용히 사라진다. 원본을 복원할 방법이
    // 없으므로 실패가 유일하게 정직한 선택이다.
    throw new Error('refusing to bind a truncated bytes value: the original bytes are lost')
  }
  if (!BASE64_RE.test(wv.v)) {
    // Buffer.from(_, 'base64')은 알파벳 밖 문자를 조용히 버린다 — 검증 없이
    // 통과시키면 "원본과 다른 바이트"가 그럴듯하게 저장된다.
    throw new Error('bytes value is not valid base64')
  }
  return Buffer.from(wv.v, 'base64')
}

/**
 * WireValue를 mysql2 바인딩 값으로. mysql2는 JS boolean을 그대로 바인딩하면
 * 드라이버 버전에 따라 안전하지 않게 취급할 수 있다(SqliteDataCapability와 동일한
 * 이유) — bool은 1/0으로, bytes는 디코드한 바이트로, 나머지는 v를 그대로.
 *
 * bigint/decimal/date를 문자열로 두는 것은 의도다: number로 바꾸면 BIGINT·DECIMAL의
 * 정밀도가 뭉개진다. 커넥션도 같은 이유로 `dateStrings`/`bigNumberStrings`로 연다.
 */
function paramOf(wv: WireValue): unknown {
  if (wv.t === 'null') return null
  if (wv.t === 'bool') return wv.v ? 1 : 0
  if (wv.t === 'bytes') return bytesParam(wv)
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

  buildBrowse(schema: string, table: string, sort?: BrowseSort, filters: readonly BrowseFilter[] = []): BuiltStatement {
    const target = `${quoteIdent(schema)}.${quoteIdent(table)}`
    const order =
      sort === undefined
        ? ''
        : ` ORDER BY ${quoteIdent(sort.column)} ${sort.direction === 'desc' ? 'DESC' : 'ASC'}`
    const where = buildBrowseFilters(filters, quoteIdent, 'mysql')
    return { sql: `SELECT * FROM ${target}${where.sql}${order}`, params: where.params }
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
      for (const [index, change] of changes.entries()) {
        const { sql, params } = buildStatement(schema, table, change)
        const [res] = await conn.query(sql, params)
        const touched = (res as { affectedRows?: number }).affectedRows ?? 0
        assertRowTouched(change, index, touched)
        affected += touched
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
