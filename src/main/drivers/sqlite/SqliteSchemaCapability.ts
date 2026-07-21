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

export class SqliteSchemaCapability implements SchemaCapability {
  constructor(private readonly getDb: () => DatabaseInstance) {}

  private schemaExists(schema: string): boolean {
    const rows = this.getDb().pragma('database_list') as DbRow[]
    return rows.some((r) => r.name === schema)
  }

  async listSchemas(_ctx: ExecutionContext): Promise<readonly SchemaInfo[]> {
    const rows = this.getDb().pragma('database_list') as DbRow[]
    return rows.map((r) => ({ name: r.name }))
  }

  async listTables(_ctx: ExecutionContext, schema: string): Promise<readonly TableInfo[]> {
    if (!this.schemaExists(schema)) return []
    const rows = this.getDb()
      .prepare(
        `SELECT name, type FROM ${quoteIdent(schema)}.sqlite_master ` +
          `WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name`,
      )
      .all() as TableRow[]
    return rows.map((r) => ({
      schema,
      name: r.name,
      kind: r.type === 'view' ? ('view' as const) : ('table' as const),
      estimatedRows: null,
    }))
  }

  async describeTable(_ctx: ExecutionContext, schema: string, table: string): Promise<TableDetail> {
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
    return { schema, name: table, columns }
  }

  async listIndexes(
    _ctx: ExecutionContext,
    schema: string,
    table: string,
  ): Promise<readonly IndexInfo[]> {
    if (!this.schemaExists(schema)) return []
    const db = this.getDb()
    const list = db.pragma(
      `${quoteIdent(schema)}.index_list(${quoteIdent(table)})`,
    ) as IndexListRow[]
    return list.map((idx) => {
      const cols = db.pragma(
        `${quoteIdent(schema)}.index_info(${quoteIdent(idx.name)})`,
      ) as IndexInfoRow[]
      return {
        name: idx.name,
        columns: cols.map((c) => c.name),
        unique: idx.unique === 1,
        sizeBytes: null,
      }
    })
  }

  async listForeignKeys(
    _ctx: ExecutionContext,
    schema: string,
    table: string,
  ): Promise<readonly ForeignKeyInfo[]> {
    if (!this.schemaExists(schema)) return []
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
    return fks
  }
}
