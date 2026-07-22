import { buildResultSet, type PageRequest, type ResultSet } from '@shared/types/resultSet'
import type { ExecutionContext } from '@main/core/driver/ExecutionContext'
import type {
  ReadOnlyScope,
  SqlCapability,
  StatementClassification,
} from '@main/core/driver/capabilities/SqlCapability'
import { classifyStatement } from '@main/core/execution/StatementClassifier'
import type { EngineId } from '@shared/types/connection'
import type { MysqlClientLike } from './MysqlDriver'
import { mapMysqlValue } from './mysqlTypeMap'

const CURSOR_PREFIX = 'mysql:1:'

/** RO 범위 안에서만 걸리는 statement timeout. PostgresSqlCapability와 동일한 이유로 상수로 둔다. */
const READ_ONLY_TIMEOUT_MS = 30_000

interface MysqlFieldMeta {
  readonly name: string
  readonly type?: number
}

/** mysql2 ResultSetHeader의 우리가 쓰는 부분만. */
interface MysqlResultHeader {
  readonly affectedRows: number
}

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

/**
 * mysql2 `rowsAsArray: true` 응답 구분: SELECT류는 행-배열의 배열이고,
 * DML은 단일 ResultSetHeader(배열이 아님)다. 멀티 문장(배치)은 이 슬라이스가
 * 지원하지 않으므로(§ classify가 단일 문장 가정) 배열 여부만으로 충분하다.
 */
function isRowArray(result: unknown): result is unknown[][] {
  return Array.isArray(result)
}

export class MysqlSqlCapability implements SqlCapability {
  constructor(
    private readonly getConn: () => MysqlClientLike,
    private readonly cancel: () => Promise<void>,
    private readonly engine: EngineId,
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
   * 커넥션에서도 같은 실행/취소 배선을 재사용할 수 있게 한다(PostgresSqlCapability와 동일 패턴).
   */
  private async executeOn(
    conn: MysqlClientLike,
    ctx: ExecutionContext,
    sql: string,
    page: PageRequest,
    params?: readonly unknown[],
  ): Promise<ResultSet> {
    if (ctx.signal.aborted) throw new Error(`execution aborted: ${ctx.requestId}`)
    const start = performance.now()

    // offset 기반: 전체를 읽고 offset부터 buildResultSet에 넘긴다.
    const offset = page.cursor === null ? 0 : decodeCursor(page.cursor, sql)

    const queryPromise = conn.query({
      sql,
      ...(params === undefined ? {} : { values: params }),
      rowsAsArray: true,
    }) as Promise<[unknown, MysqlFieldMeta[] | undefined]>

    const onAbort = (): void => {
      void this.cancel()
    }
    if (ctx.signal.aborted) onAbort()
    else ctx.signal.addEventListener('abort', onAbort, { once: true })

    let result: unknown
    let fields: MysqlFieldMeta[] | undefined
    try {
      // 취소를 보내도 주 쿼리는 보통 취소 에러(KILL QUERY → ER_QUERY_INTERRUPTED)로
      // "끝난다" — 그 종료를 기다린다. 이렇게 해야 커넥션이 quiescent해진 뒤에 반납된다.
      //
      // 예외: `SLEEP()`/`BENCHMARK()`는 MySQL이 문서화한 특례로, KILL QUERY를
      // 받으면 **에러 없이** 조기 반환한다(실측 확인). 이 경우 queryPromise는
      // 정상적으로 resolve하지만 이미 abort가 요청된 뒤이므로, 아래에서 abort
      // 여부를 다시 확인해 이 특례가 "취소했는데 성공한 결과"를 호출자에게
      // 흘려보내지 않게 한다.
      ;[result, fields] = await queryPromise
    } catch (e) {
      if (ctx.signal.aborted) throw new Error(`execution aborted: ${ctx.requestId}`)
      throw e
    } finally {
      ctx.signal.removeEventListener('abort', onAbort)
    }

    // § SLEEP()/BENCHMARK() 특례 — 쿼리가 예외 없이 끝났어도 이미 취소가
    // 요청됐으면 거부한다. 커넥션은 이미 quiescent하다(위에서 완전히 기다렸다).
    if (ctx.signal.aborted) throw new Error(`execution aborted: ${ctx.requestId}`)

    const durationMs = performance.now() - start

    if (!isRowArray(result)) {
      // 쓰기: ResultSetHeader. 커서를 내지 않는다 — offset 재실행이 쓰기를
      // 이중으로 반영하는 것을 막기 위해서다(§ PostgresSqlCapability와 동일 이유).
      const header = result as MysqlResultHeader
      return buildResultSet({
        requestId: ctx.requestId,
        columns: [],
        rows: [],
        page,
        durationMs,
        cursorAt: () => null,
        rowsAffected: header.affectedRows,
      })
    }

    const cols = fields ?? []
    const columns = cols.map((f) => ({ name: f.name, type: String(f.type ?? -1) }))
    const rawRows = result.slice(offset)
    const rows = rawRows.map((row) => row.map((value, i) => mapMysqlValue(cols[i]?.type ?? -1, value)))
    const total = result.length

    return buildResultSet({
      requestId: ctx.requestId,
      columns,
      rows,
      page,
      durationMs,
      cursorAt: (kept) => (offset + kept < total ? encodeCursor(sql, offset + kept) : null),
    })
  }

  async beginReadOnly(ctx: ExecutionContext): Promise<ReadOnlyScope> {
    if (ctx.signal.aborted) throw new Error(`execution aborted: ${ctx.requestId}`)
    const conn = this.getConn()
    await conn.query('START TRANSACTION READ ONLY')
    try {
      // RO 범위 안에서만 걸리는 timeout. MySQL과 MariaDB는 변수 이름과 단위가 다르다
      // (MySQL: max_execution_time, 밀리초 / MariaDB: max_statement_time, 초).
      if (this.engine === 'mariadb') {
        await conn.query(`SET SESSION max_statement_time = ${READ_ONLY_TIMEOUT_MS / 1000}`)
      } else {
        await conn.query(`SET SESSION max_execution_time = ${READ_ONLY_TIMEOUT_MS}`)
      }
    } catch (e) {
      // 이 드라이버는 커넥션을 풀링하지 않는다 — START TRANSACTION 이후 실패를
      // 그냥 던지면 이 커넥션은 열린 트랜잭션에 갇혀 이후 모든 실행이 막힌다.
      // 설정 실패 시 트랜잭션을 되돌려 커넥션을 다시 쓸 수 있게 한다.
      await conn.query('ROLLBACK').catch(() => {})
      throw e
    }

    return {
      execute: (scopeCtx: ExecutionContext, sql: string, page: PageRequest, params?: readonly unknown[]) =>
        this.executeOn(conn, scopeCtx, sql, page, params),
      end: async () => {
        await conn.query('COMMIT')
      },
    }
  }

  classify(sql: string): StatementClassification {
    // 코어 분류기(모든 방언 최엄격)에 위임한다 — 규칙을 재구현하지 않는다.
    // classifyStatement는 엔진 독립적이다(모든 지원 엔진의 어휘를 이미 함께
    // 평가해 최엄격값을 낸다) — mysql/mariadb 구분 인자를 받지 않는다.
    return classifyStatement(sql)
  }
}
