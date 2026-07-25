import {
  buildResultSet,
  type ColumnOrigin,
  type PageRequest,
  type ResultSet,
} from '../../../shared/types/resultSet'
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

/**
 * `pg_attribute`에서 (테이블 OID, attnum) → (테이블 이름, 컬럼 이름)을 읽는다.
 *
 * PostgreSQL은 RowDescription에 이름이 아니라 OID와 attnum만 담아 보내므로,
 * 원본 컬럼 이름은 카탈로그를 봐야 안다. `format('%s', ...::regclass)`가 아니라
 * `pg_class.relname`을 쓰는 이유는 regclass 캐스트가 search_path에 따라
 * 스키마 접두사를 붙였다 말았다 하기 때문이다 — 판정에 쓰는 값이 세션 설정에
 * 따라 흔들리면 안 된다.
 */
const ORIGIN_LOOKUP_SQL = `
  SELECT a.attrelid::int8 AS relid, a.attnum::int4 AS attnum, a.attname AS column_name, c.relname AS table_name
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  WHERE (a.attrelid, a.attnum) IN (SELECT * FROM unnest($1::oid[], $2::int2[]))
`

interface OriginRow {
  readonly relid: string | number
  readonly attnum: number
  readonly column_name: string
  readonly table_name: string
}

function originKey(tableId: number, columnId: number): string {
  return `${tableId}:${columnId}`
}

export class PostgresSqlCapability implements SqlCapability {
  /**
   * (relid, attnum) → 원본 이름 캐시.
   *
   * 커넥션(=드라이버 인스턴스) 수명 동안 유지한다. 같은 테이블을 반복 조회하는
   * 것이 정상 사용 패턴이므로, 카탈로그 왕복은 테이블당 한 번으로 끝난다.
   *
   * DDL로 컬럼 이름이 바뀌면 캐시가 낡는다. 이 값은 마스킹 판정에만 쓰이므로
   * 위험한 방향은 "가려야 할 컬럼을 못 알아보는" 쪽인데, 거기까지 가려면 두 가지가
   * 겹쳐야 한다: 세션 중에 컬럼이 마스킹 대상 이름으로 개명되고, **그 위에 별칭까지**
   * 붙어야 한다. 별칭이 없으면 pg가 보고하는 표시 이름은 항상 최신이라 이름 검사가
   * 그대로 잡는다. 남는 틈은 이 조합뿐이고, 그걸 막으려고 매 실행마다 카탈로그를
   * 왕복하는 것은 값이 맞지 않는다.
   */
  private readonly originCache = new Map<string, { table: string; column: string }>()

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

    const origins = ctx.resolveColumnOrigins
      ? await this.resolveOrigins(conn, result.fields)
      : undefined
    const columns = result.fields.map((f, i) => {
      const origin = origins?.[i]
      return {
        name: f.name,
        type: String(f.dataTypeID),
        ...(origin === undefined ? {} : { origin }),
      }
    })
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

  /**
   * RowDescription의 (tableID, columnID)를 원본 이름으로 되짚는다.
   *
   * `columnID === 0`은 "테이블 컬럼이 아니다"라는 서버의 적극적인 보고다(식·집계·
   * 리터럴) — 그건 조회 없이 바로 `computed`다. 조회가 필요한 것은 나머지뿐이고,
   * 캐시가 채워져 있으면 왕복도 없다.
   *
   * 조회가 실패한 컬럼은 `unresolved`다 — "테이블 컬럼인 건 맞는데 이름을 모른다".
   * `computed`로 적으면 "식이라서 원본이 없다"는 거짓이고, 비우면 "출처 개념이
   * 없는 엔진"이라는 다른 거짓이다. 둘 다 마스킹을 느슨한 쪽으로 틀리게 만든다.
   * 카탈로그를 못 읽는 것 자체가 실행을 실패시킬 이유는 아니므로(권한이 좁은 AI
   * 읽기 전용 계정에서 실제로 일어날 수 있다) 던지지 않는다.
   */
  private async resolveOrigins(
    conn: PgClientLike,
    fields: readonly { readonly tableID?: number; readonly columnID?: number }[],
  ): Promise<readonly ColumnOrigin[]> {
    const missing = new Map<string, { tableId: number; columnId: number }>()
    for (const f of fields) {
      const tableId = f.tableID ?? 0
      const columnId = f.columnID ?? 0
      if (tableId === 0 || columnId === 0) continue
      const key = originKey(tableId, columnId)
      if (!this.originCache.has(key)) missing.set(key, { tableId, columnId })
    }

    if (missing.size > 0) {
      try {
        const wanted = [...missing.values()]
        const r = await conn.query({
          text: ORIGIN_LOOKUP_SQL,
          values: [wanted.map((w) => w.tableId), wanted.map((w) => w.columnId)],
        })
        for (const row of r.rows as OriginRow[]) {
          this.originCache.set(originKey(Number(row.relid), row.attnum), {
            table: row.table_name,
            column: row.column_name,
          })
        }
      } catch {
        // 캐시가 비어 있는 컬럼은 아래에서 unresolved가 된다 — 그게 의도다.
      }
    }

    return fields.map((f) => {
      const tableId = f.tableID ?? 0
      const columnId = f.columnID ?? 0
      if (tableId === 0 || columnId === 0) return { kind: 'computed' as const }
      const hit = this.originCache.get(originKey(tableId, columnId))
      return hit === undefined ? { kind: 'unresolved' as const } : { kind: 'column' as const, ...hit }
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
