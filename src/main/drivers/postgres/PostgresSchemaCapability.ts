import type { ExecutionContext } from '../../core/driver/ExecutionContext'
import type {
  ColumnInfo,
  ForeignKeyInfo,
  IndexInfo,
  SchemaCapability,
  SchemaInfo,
  TableDetail,
  TableInfo,
  TableKind,
} from '../../core/driver/capabilities/SchemaCapability'
import type { PgClientLike } from './PostgresDriver'

function q(conn: PgClientLike, text: string, values: readonly unknown[]): Promise<{ rows: unknown[] }> {
  return conn.query({ text, values })
}

function checkAborted(ctx: ExecutionContext): void {
  if (ctx.signal.aborted) throw new Error(`execution aborted: ${ctx.requestId}`)
}

function tableKind(relkind: string): TableKind {
  if (relkind === 'v') return 'view'
  if (relkind === 'm') return 'materialized_view'
  return 'table'
}

/**
 * `information_schema`/`pg_catalog` 질의로 스키마 인트로스펙션을 구현한다.
 * 모든 질의는 스키마/테이블 이름을 파라미터 바인딩으로 넘긴다(문자열 결합 금지).
 *
 * `array_agg(x.attname ORDER BY ...)`는 반드시 `::text`로 캐스트한다 — `attname`의
 * 실제 타입은 `name`이라 캐스트 없이 집계하면 결과 컬럼 OID가 `_name`(1003)이
 * 되는데, node-postgres(pg-types)는 이 OID에 배열 파서를 등록해 두지 않아
 * `['a','b']`가 아니라 문자열 `'{a,b}'`가 그대로 온다. `_text`(1009)는 기본
 * 파서가 있어 `::text` 캐스트만으로 배열이 정상적으로 파싱된다. 라이브 pg로
 * 확인한 뒤 반영했다.
 */
export class PostgresSchemaCapability implements SchemaCapability {
  constructor(private readonly getConn: () => PgClientLike) {}

  async listSchemas(ctx: ExecutionContext): Promise<readonly SchemaInfo[]> {
    checkAborted(ctx)
    const r = await q(
      this.getConn(),
      `SELECT nspname AS name FROM pg_namespace
       WHERE nspname NOT IN ('pg_catalog','information_schema') AND nspname NOT LIKE 'pg_%'
       ORDER BY nspname`,
      [],
    )
    return (r.rows as { name: string }[]).map((row) => ({ name: row.name }))
  }

  async listTables(ctx: ExecutionContext, schema: string): Promise<readonly TableInfo[]> {
    checkAborted(ctx)
    const r = await q(
      this.getConn(),
      `SELECT c.relname AS name, c.relkind AS relkind,
              CASE WHEN c.reltuples < 0 THEN NULL ELSE c.reltuples::bigint END AS est
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = $1 AND c.relkind IN ('r','v','m','p')
       ORDER BY c.relname`,
      [schema],
    )
    return (r.rows as { name: string; relkind: string; est: string | null }[]).map((row) => ({
      schema,
      name: row.name,
      kind: tableKind(row.relkind),
      estimatedRows: row.est === null ? null : Number(row.est),
    }))
  }

  async describeTable(ctx: ExecutionContext, schema: string, table: string): Promise<TableDetail> {
    checkAborted(ctx)
    const r = await q(
      this.getConn(),
      `SELECT a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type,
              NOT a.attnotnull AS nullable, pg_get_expr(ad.adbin, ad.adrelid) AS dflt,
              -- indkey는 int2vector라 0-based로 인덱싱된다(일반 배열과 달리 lower
              -- bound가 1이 아니라 0) — array_position이 주는 값에 +1을 해야
              -- 1-based ordinal이 된다. 라이브 pg로 확인: PK (a,b)에서 보정 없이는
              -- a=0/b=1이 나왔다.
              (SELECT array_position(i.indkey, a.attnum) + 1 FROM pg_index i
               WHERE i.indrelid = a.attrelid AND i.indisprimary) AS pk_pos
       FROM pg_attribute a
       JOIN pg_class c ON c.oid = a.attrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
       WHERE n.nspname = $1 AND c.relname = $2 AND a.attnum > 0 AND NOT a.attisdropped
       ORDER BY a.attnum`,
      [schema, table],
    )
    const columns: ColumnInfo[] = (
      r.rows as {
        name: string
        type: string
        nullable: boolean
        dflt: string | null
        pk_pos: number | null
      }[]
    ).map((row) => ({
      name: row.name,
      type: row.type,
      nullable: row.nullable,
      defaultValue: row.dflt,
      // 쿼리에서 이미 +1 보정을 했으므로 여기서는 그대로 쓴다. PK가 아니면
      // 서브쿼리가 null을 준다.
      primaryKeyOrdinal: row.pk_pos === null ? null : Number(row.pk_pos),
    }))
    // 스키마나 테이블이 없으면 위 질의가 조용히 0행을 준다 — 컬럼 없는 빈
    // TableDetail을 "존재하는 테이블"처럼 돌려주면 안 된다. 스키마 한정자를
    // 실제로 쓰는지 증명하는 계약 조항이 바로 이 경로를 짚는다.
    if (columns.length === 0) {
      throw new Error(`table not found: ${schema}.${table}`)
    }
    return { schema, name: table, columns }
  }

  async listIndexes(ctx: ExecutionContext, schema: string, table: string): Promise<readonly IndexInfo[]> {
    checkAborted(ctx)
    const r = await q(
      this.getConn(),
      `SELECT i.relname AS name, ix.indisunique AS uniq,
              array_agg(a.attname::text ORDER BY k.ord) AS cols,
              pg_relation_size(i.oid) AS size
       FROM pg_index ix
       JOIN pg_class i ON i.oid = ix.indexrelid
       JOIN pg_class t ON t.oid = ix.indrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
       JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ord) ON true
       JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
       WHERE n.nspname = $1 AND t.relname = $2
       GROUP BY i.relname, ix.indisunique, i.oid
       ORDER BY i.relname`,
      [schema, table],
    )
    return (r.rows as { name: string; uniq: boolean; cols: string[]; size: string | null }[]).map((row) => ({
      name: row.name,
      columns: row.cols,
      unique: row.uniq,
      sizeBytes: row.size === null ? null : Number(row.size),
    }))
  }

  async listForeignKeys(
    ctx: ExecutionContext,
    schema: string,
    table: string,
  ): Promise<readonly ForeignKeyInfo[]> {
    checkAborted(ctx)
    const r = await q(
      this.getConn(),
      `SELECT con.conname AS name,
              (SELECT array_agg(att.attname::text ORDER BY k.ord)
                 FROM unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord)
                 JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = k.attnum) AS cols,
              fn.nspname AS ref_schema, ft.relname AS ref_table,
              (SELECT array_agg(att.attname::text ORDER BY k.ord)
                 FROM unnest(con.confkey) WITH ORDINALITY AS k(attnum, ord)
                 JOIN pg_attribute att ON att.attrelid = con.confrelid AND att.attnum = k.attnum) AS ref_cols
       FROM pg_constraint con
       JOIN pg_class c ON c.oid = con.conrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_class ft ON ft.oid = con.confrelid
       JOIN pg_namespace fn ON fn.oid = ft.relnamespace
       WHERE n.nspname = $1 AND c.relname = $2 AND con.contype = 'f'
       ORDER BY con.conname`,
      [schema, table],
    )
    return (
      r.rows as {
        name: string
        cols: string[]
        ref_schema: string
        ref_table: string
        ref_cols: string[]
      }[]
    ).map((row) => ({
      name: row.name,
      columns: row.cols,
      referencedSchema: row.ref_schema,
      referencedTable: row.ref_table,
      referencedColumns: row.ref_cols,
    }))
  }
}
