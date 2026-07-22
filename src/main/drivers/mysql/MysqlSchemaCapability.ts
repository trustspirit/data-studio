import type {
  SchemaCapability,
  SchemaInfo,
  TableInfo,
  TableDetail,
  ColumnInfo,
  IndexInfo,
  ForeignKeyInfo,
} from '@main/core/driver/capabilities/SchemaCapability'
import type { ExecutionContext } from '@main/core/driver/ExecutionContext'
import type { MysqlClientLike } from './MysqlDriver'

const SYSTEM_SCHEMAS = ['information_schema', 'performance_schema', 'mysql', 'sys']

function checkAborted(ctx: ExecutionContext): void {
  if (ctx.signal.aborted) throw new Error(`execution aborted: ${ctx.requestId}`)
}

async function rows<T>(conn: MysqlClientLike, sql: string, params: readonly unknown[]): Promise<T[]> {
  const [res] = await conn.query(sql, params)
  return res as T[]
}

/**
 * `information_schema` 질의로 스키마 인트로스펙션을 구현한다. MySQL/MariaDB는
 * schema=database라 스키마 목록도 `information_schema.SCHEMATA`(=데이터베이스
 * 목록)에서 나온다. 모든 질의는 스키마/테이블 이름을 파라미터 바인딩으로
 * 넘긴다(문자열 결합 금지) — PostgresSchemaCapability와 동일 패턴.
 */
export class MysqlSchemaCapability implements SchemaCapability {
  constructor(private readonly getConn: () => MysqlClientLike) {}

  async listSchemas(ctx: ExecutionContext): Promise<readonly SchemaInfo[]> {
    checkAborted(ctx)
    const r = await rows<{ SCHEMA_NAME: string }>(
      this.getConn(),
      `SELECT SCHEMA_NAME FROM information_schema.SCHEMATA
       WHERE SCHEMA_NAME NOT IN (?, ?, ?, ?) ORDER BY SCHEMA_NAME`,
      SYSTEM_SCHEMAS,
    )
    return r.map((x) => ({ name: x.SCHEMA_NAME }))
  }

  async listTables(ctx: ExecutionContext, schema: string): Promise<readonly TableInfo[]> {
    checkAborted(ctx)
    const r = await rows<{ TABLE_NAME: string; TABLE_TYPE: string; TABLE_ROWS: number | string | null }>(
      this.getConn(),
      `SELECT TABLE_NAME, TABLE_TYPE, TABLE_ROWS FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME`,
      [schema],
    )
    return r.map((x) => ({
      schema,
      name: x.TABLE_NAME,
      kind: x.TABLE_TYPE === 'VIEW' ? 'view' : 'table',
      // 커넥션이 bigNumberStrings로 열려 있어 BIGINT 컬럼인 TABLE_ROWS가 문자열로
      // 온다(MySQL 8 기준). 행 수 추정치는 정밀도 손실 걱정이 없는 작은 정수라
      // Number로 되돌린다.
      estimatedRows: x.TABLE_ROWS === null ? null : Number(x.TABLE_ROWS),
    }))
  }

  async describeTable(ctx: ExecutionContext, schema: string, table: string): Promise<TableDetail> {
    checkAborted(ctx)
    const conn = this.getConn()
    const cols = await rows<{
      COLUMN_NAME: string
      COLUMN_TYPE: string
      IS_NULLABLE: string
      COLUMN_DEFAULT: string | null
    }>(
      conn,
      `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
       FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
       ORDER BY ORDINAL_POSITION`,
      [schema, table],
    )
    // 스키마나 테이블이 없으면 위 질의가 조용히 0행을 준다 — 컬럼 없는 빈
    // TableDetail을 "존재하는 테이블"처럼 돌려주면 안 된다. 스키마 한정자를
    // 실제로 쓰는지 증명하는 계약 조항이 바로 이 경로를 짚는다.
    if (cols.length === 0) throw new Error(`table not found: ${schema}.${table}`)
    // PK ordinal: KEY_COLUMN_USAGE의 PRIMARY 제약(복합 PK는 ORDINAL_POSITION이 1-based 순서를 준다).
    // MariaDB는 이 컬럼을 BIGINT로 선언해(MySQL 8은 INT) bigNumberStrings 커넥션에서
    // 문자열로 온다 — 정렬 순서일 뿐인 작은 정수라 Number로 되돌린다.
    const pk = await rows<{ COLUMN_NAME: string; ORDINAL_POSITION: number | string }>(
      conn,
      `SELECT COLUMN_NAME, ORDINAL_POSITION FROM information_schema.KEY_COLUMN_USAGE
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND CONSTRAINT_NAME = 'PRIMARY'
       ORDER BY ORDINAL_POSITION`,
      [schema, table],
    )
    const pkOrder = new Map(pk.map((p) => [p.COLUMN_NAME, Number(p.ORDINAL_POSITION)]))
    const columns: ColumnInfo[] = cols.map((c) => ({
      name: c.COLUMN_NAME,
      type: c.COLUMN_TYPE,
      nullable: c.IS_NULLABLE === 'YES',
      defaultValue: c.COLUMN_DEFAULT,
      primaryKeyOrdinal: pkOrder.get(c.COLUMN_NAME) ?? null,
    }))
    return { schema, name: table, columns }
  }

  async listIndexes(ctx: ExecutionContext, schema: string, table: string): Promise<readonly IndexInfo[]> {
    checkAborted(ctx)
    const r = await rows<{
      INDEX_NAME: string
      // NOT NULL 컬럼이라 null 가드는 필요 없다. MariaDB는 BIGINT로 선언해(MySQL 8은
      // INT/TINYINT라 보통 숫자로 온다) bigNumberStrings 커넥션에서 문자열 "0"/"1"로
      // 온다 — `=== 0` 비교가 항상 false가 돼 모든 인덱스가 non-unique로 보였다.
      NON_UNIQUE: number | string
      COLUMN_NAME: string
      SEQ_IN_INDEX: number
    }>(
      this.getConn(),
      `SELECT INDEX_NAME, NON_UNIQUE, COLUMN_NAME, SEQ_IN_INDEX FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY INDEX_NAME, SEQ_IN_INDEX`,
      [schema, table],
    )
    const byName = new Map<string, { columns: string[]; unique: boolean }>()
    for (const x of r) {
      const e = byName.get(x.INDEX_NAME) ?? { columns: [], unique: Number(x.NON_UNIQUE) === 0 }
      e.columns.push(x.COLUMN_NAME)
      byName.set(x.INDEX_NAME, e)
    }
    return [...byName.entries()].map(([name, e]) => ({
      name,
      columns: e.columns,
      unique: e.unique,
      sizeBytes: null,
    }))
  }

  async listForeignKeys(
    ctx: ExecutionContext,
    schema: string,
    table: string,
  ): Promise<readonly ForeignKeyInfo[]> {
    checkAborted(ctx)
    const r = await rows<{
      CONSTRAINT_NAME: string
      COLUMN_NAME: string
      // SQL 쪽 ORDER BY에만 쓰이고 JS에서 읽거나 비교하지 않는다. MariaDB는
      // bigNumberStrings 커넥션에서 이 컬럼을 문자열로 준다(MySQL 8은 숫자로 온다).
      ORDINAL_POSITION: number | string
      REFERENCED_TABLE_SCHEMA: string
      REFERENCED_TABLE_NAME: string
      REFERENCED_COLUMN_NAME: string
    }>(
      this.getConn(),
      `SELECT CONSTRAINT_NAME, COLUMN_NAME, ORDINAL_POSITION, REFERENCED_TABLE_SCHEMA,
              REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
       FROM information_schema.KEY_COLUMN_USAGE
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND REFERENCED_TABLE_NAME IS NOT NULL
       ORDER BY CONSTRAINT_NAME, ORDINAL_POSITION`,
      [schema, table],
    )
    const byName = new Map<
      string,
      { columns: string[]; referencedSchema: string; referencedTable: string; referencedColumns: string[] }
    >()
    for (const x of r) {
      const e = byName.get(x.CONSTRAINT_NAME) ?? {
        columns: [],
        referencedSchema: x.REFERENCED_TABLE_SCHEMA,
        referencedTable: x.REFERENCED_TABLE_NAME,
        referencedColumns: [],
      }
      e.columns.push(x.COLUMN_NAME)
      e.referencedColumns.push(x.REFERENCED_COLUMN_NAME)
      byName.set(x.CONSTRAINT_NAME, e)
    }
    return [...byName.entries()].map(([name, e]) => ({
      name,
      columns: e.columns,
      referencedSchema: e.referencedSchema,
      referencedTable: e.referencedTable,
      referencedColumns: e.referencedColumns,
    }))
  }
}
