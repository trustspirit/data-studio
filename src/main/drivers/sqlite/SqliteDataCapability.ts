import type { BrowseFilter, BrowseSort, RowChange } from '../../../shared/types/operation'
import { buildBrowseFilters } from '../../core/driver/capabilities/browseFilters'
import type { WireValue } from '../../../shared/types/wire'
import type {
  ApplyResult,
  BuiltStatement,
  DataCapability,
} from '../../core/driver/capabilities/DataCapability'
import type { ExecutionContext } from '../../core/driver/ExecutionContext'
import type { DatabaseInstance } from './SqliteDriver'
import { assertRowTouched } from '../../core/driver/capabilities/rowChangeGuard'

/** SQLite 식별자 인용. 내부 큰따옴표 이중화 — 인젝션 방지. */
function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}

/** 표준 base64(패딩 포함). `wire.bytes`가 내보내는 형태와 정확히 같다. */
const BASE64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

/**
 * bytes WireValue를 실제 바이트로 되돌린다.
 *
 * `wv.v`는 원본 바이트가 아니라 base64 **문자열**이다(`wire.bytes` 참고).
 * 그대로 바인딩하면 BLOB 컬럼에 base64 ASCII가 TEXT로 저장되고, 이진 PK를
 * WHERE에 쓰면 어느 행과도 매칭되지 않은 채 성공(0행)으로 보고된다 —
 * SQLite는 BLOB과 TEXT를 서로 다른 값으로 비교하므로 에러 없이 그냥 빗나간다.
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
 * WireValue를 better-sqlite3 바인딩 값으로. better-sqlite3는 숫자·문자열·bigint·
 * Buffer·null만 받고 JS boolean에 던진다 — bool은 1/0으로, bytes는 디코드한
 * 바이트로, 나머지는 v를 그대로.
 *
 * bigint/decimal을 문자열로 두는 것은 의도다: number로 바꾸면 2^53을 넘는 정수가
 * 뭉개지고, 숫자 꼴 문자열은 INTEGER/REAL/NUMERIC 컬럼에서 SQLite의 타입 친화성이
 * 알아서 변환한다. TEXT 컬럼이라면 문자열로 남는 편이 오히려 옳다.
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

  buildBrowse(schema: string, table: string, sort?: BrowseSort, filters: readonly BrowseFilter[] = []): BuiltStatement {
    const target = `${quoteIdent(schema)}.${quoteIdent(table)}`
    const order =
      sort === undefined
        ? ''
        : ` ORDER BY ${quoteIdent(sort.column)} ${sort.direction === 'desc' ? 'DESC' : 'ASC'}`
    const where = buildBrowseFilters(filters, quoteIdent, 'sqlite')
    return { sql: `SELECT * FROM ${target}${where.sql}${order}`, params: where.params }
  }

  applyChanges(
    ctx: ExecutionContext,
    schema: string,
    table: string,
    changes: readonly RowChange[],
  ): Promise<ApplyResult> {
    // better-sqlite3는 동기다 — MemoryDriver 관용구대로 try/catch로 감싸 동기 throw를
    // rejection으로 바꾼다. 취소는 진입 시 abort 사전검사로 구현한다.
    try {
      if (ctx.signal.aborted) throw new Error(`execution aborted: ${ctx.requestId}`)
      const db = this.getDb()
      let affected = 0
      // transaction()은 콜백이 throw하면 자동 롤백한다(동기).
      const tx = db.transaction((list: readonly RowChange[]) => {
        for (const [index, change] of list.entries()) {
          const { sql, params } = buildStatement(schema, table, change)
          const info = (db.prepare(sql) as unknown as RunStmt).run(...params)
          assertRowTouched(change, index, info.changes)
          affected += info.changes
        }
      })
      tx(changes)
      return Promise.resolve({ affected })
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)))
    }
  }
}
