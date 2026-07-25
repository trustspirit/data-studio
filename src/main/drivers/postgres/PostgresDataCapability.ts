import type { BrowseSort, RowChange } from '../../../shared/types/operation'
import type { WireValue } from '../../../shared/types/wire'
import type {
  ApplyResult,
  BuiltStatement,
  DataCapability,
} from '../../core/driver/capabilities/DataCapability'
import type { ExecutionContext } from '../../core/driver/ExecutionContext'
import type { PgClientLike } from './PostgresDriver'
import { assertRowTouched } from '../../core/driver/capabilities/rowChangeGuard'

/** PostgreSQL 식별자 인용. 내부 큰따옴표는 이중화한다 — 인젝션 방지의 핵심. */
function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}

/** 표준 base64(패딩 포함). `wire.bytes`가 내보내는 형태와 정확히 같다. */
const BASE64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

/**
 * bytes WireValue를 실제 바이트로 되돌린다.
 *
 * `wv.v`는 원본 바이트가 아니라 base64 **문자열**이다(`wire.bytes` 참고).
 * 그대로 바인딩하면 bytea 컬럼에 base64 ASCII가 저장되고, 이진 PK를 WHERE에
 * 쓰면 어느 행과도 매칭되지 않는다 — base64 알파벳에는 백슬래시가 없어서
 * PostgreSQL이 그 문자열을 escape 형식 bytea로 조용히 재해석할 뿐 에러를 내지
 * 않는다. 그래서 0행 삭제/수정이 성공으로 보고된다.
 *
 * `Buffer`/`Uint8Array`는 pg가 `prepareValue`에서 hex 리터럴로 직렬화한다.
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
 * WireValue를 파라미터 바인딩 값으로 — null은 SQL NULL, bytes는 디코드한 바이트,
 * 그 외는 내부 v.
 *
 * bigint/decimal/date를 문자열 그대로 두는 것은 의도다: number로 바꾸면
 * int8·numeric의 정밀도가 뭉개지고, 문자열은 서버가 대상 컬럼 타입으로
 * 캐스팅하므로 정밀도도 벽시계 값도 그대로 간다.
 */
function paramOf(wv: WireValue): unknown {
  if (wv.t === 'null') return null
  if (wv.t === 'bytes') return bytesParam(wv)
  return wv.v
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
      for (const [index, change] of changes.entries()) {
        const { sql, params } = buildStatement(schema, table, change)
        const res = await conn.query({ text: sql, values: params })
        const touched = res.rowCount ?? 0
        assertRowTouched(change, index, touched)
        affected += touched
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
