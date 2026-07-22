import type { ExecutionContext } from '../../core/driver/ExecutionContext'
import type {
  SchemaCapability,
  SchemaInfo,
  TableInfo,
  TableDetail,
  ColumnInfo,
  IndexInfo,
  ForeignKeyInfo,
} from '../../core/driver/capabilities/SchemaCapability'
import type { DatabaseInstance } from './SqliteDriver'

/** SQLite 식별자 인용. 내부 큰따옴표 이중화 — 인젝션 방지. */
function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}

function assertNotAborted(ctx: ExecutionContext): void {
  if (ctx.signal.aborted) throw new Error(`execution aborted: ${ctx.requestId}`)
}
function rejected(error: unknown): Promise<never> {
  return Promise.reject(error instanceof Error ? error : new Error(String(error)))
}

interface DbRow {
  readonly name: string
}
interface TableRow {
  readonly name: string
  readonly type: string
}
interface TableInfoRow {
  readonly name: string
  readonly type: string
  readonly notnull: number
  readonly dflt_value: string | null
  readonly pk: number
}
interface IndexListRow {
  readonly name: string
  readonly unique: number
}
interface IndexInfoRow {
  readonly name: string
}
interface FkRow {
  readonly id: number
  readonly seq: number
  readonly table: string
  readonly from: string
  readonly to: string
}

/**
 * SQLite schema 능력(PRAGMA 인트로스펙션). better-sqlite3가 동기라 MemoryDriver
 * 관용구를 따른다 — 비-async 메서드가 try/catch로 감싸 성공은 `Promise.resolve`,
 * 예외는 `Promise.reject`로 돌려준다.
 */
export class SqliteSchemaCapability implements SchemaCapability {
  constructor(private readonly getDb: () => DatabaseInstance) {}

  private schemaExists(schema: string): boolean {
    const rows = this.getDb().pragma('database_list') as DbRow[]
    return rows.some((r) => r.name === schema)
  }

  listSchemas(ctx: ExecutionContext): Promise<readonly SchemaInfo[]> {
    try {
      assertNotAborted(ctx)
      const rows = this.getDb().pragma('database_list') as DbRow[]
      return Promise.resolve(rows.map((r) => ({ name: r.name })))
    } catch (error) {
      return rejected(error)
    }
  }

  listTables(ctx: ExecutionContext, schema: string): Promise<readonly TableInfo[]> {
    try {
      assertNotAborted(ctx)
      if (!this.schemaExists(schema)) return Promise.resolve([])
      const rows = this.getDb()
        .prepare(
          `SELECT name, type FROM ${quoteIdent(schema)}.sqlite_master ` +
            `WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name`,
        )
        .all() as TableRow[]
      return Promise.resolve(
        rows.map((r) => ({
          schema,
          name: r.name,
          kind: r.type === 'view' ? ('view' as const) : ('table' as const),
          estimatedRows: null,
        })),
      )
    } catch (error) {
      return rejected(error)
    }
  }

  describeTable(ctx: ExecutionContext, schema: string, table: string): Promise<TableDetail> {
    try {
      assertNotAborted(ctx)
      if (!this.schemaExists(schema)) throw new Error(`unknown schema: ${schema}`)
      const rows = this.getDb().pragma(
        `${quoteIdent(schema)}.table_info(${quoteIdent(table)})`,
      ) as TableInfoRow[]
      if (rows.length === 0) throw new Error(`unknown table: ${schema}.${table}`)
      const columns: ColumnInfo[] = rows.map((r) => ({
        name: r.name,
        type: r.type,
        nullable: r.notnull === 0,
        defaultValue: r.dflt_value,
        primaryKeyOrdinal: r.pk === 0 ? null : r.pk,
      }))
      return Promise.resolve({ schema, name: table, columns })
    } catch (error) {
      return rejected(error)
    }
  }

  listIndexes(ctx: ExecutionContext, schema: string, table: string): Promise<readonly IndexInfo[]> {
    try {
      assertNotAborted(ctx)
      if (!this.schemaExists(schema)) return Promise.resolve([])
      const db = this.getDb()
      const list = db.pragma(
        `${quoteIdent(schema)}.index_list(${quoteIdent(table)})`,
      ) as IndexListRow[]
      return Promise.resolve(
        list.map((idx) => {
          const cols = db.pragma(
            `${quoteIdent(schema)}.index_info(${quoteIdent(idx.name)})`,
          ) as IndexInfoRow[]
          return {
            name: idx.name,
            columns: cols.map((c) => c.name),
            unique: idx.unique === 1,
            sizeBytes: null,
          }
        }),
      )
    } catch (error) {
      return rejected(error)
    }
  }

  listForeignKeys(
    ctx: ExecutionContext,
    schema: string,
    table: string,
  ): Promise<readonly ForeignKeyInfo[]> {
    try {
      assertNotAborted(ctx)
      if (!this.schemaExists(schema)) return Promise.resolve([])
      const rows = this.getDb().pragma(
        `${quoteIdent(schema)}.foreign_key_list(${quoteIdent(table)})`,
      ) as FkRow[]
      const byId = new Map<number, FkRow[]>()
      for (const row of rows) {
        const group = byId.get(row.id) ?? []
        group.push(row)
        byId.set(row.id, group)
      }
      const fks: ForeignKeyInfo[] = []
      for (const [id, group] of byId) {
        const ordered = [...group].sort((a, b) => a.seq - b.seq)
        fks.push({
          name: `fk_${table}_${id}`,
          columns: ordered.map((r) => r.from),
          referencedSchema: schema,
          referencedTable: ordered[0]?.table ?? '',
          referencedColumns: ordered.map((r) => r.to),
        })
      }
      return Promise.resolve(fks)
    } catch (error) {
      return rejected(error)
    }
  }
}
