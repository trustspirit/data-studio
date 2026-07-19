import type { ExecutionContext } from '../ExecutionContext'

export interface SchemaInfo {
  readonly name: string
}

export interface TableInfo {
  readonly schema: string
  readonly name: string
  /** 추정 행 수. 엔진이 제공하지 않으면 null. */
  readonly estimatedRows: number | null
}

export interface ColumnInfo {
  readonly name: string
  readonly type: string
  readonly nullable: boolean
  readonly defaultValue: string | null
  readonly isPrimaryKey: boolean
}

export interface TableDetail {
  readonly schema: string
  readonly name: string
  readonly columns: readonly ColumnInfo[]
}

export interface IndexInfo {
  readonly name: string
  readonly columns: readonly string[]
  readonly unique: boolean
  /** 바이트 단위 크기. 엔진이 제공하지 않으면 null. */
  readonly sizeBytes: number | null
}

export interface ForeignKeyInfo {
  readonly name: string
  readonly columns: readonly string[]
  readonly referencedSchema: string
  readonly referencedTable: string
  readonly referencedColumns: readonly string[]
}

/**
 * 스키마 인트로스펙션. AI 어시스턴트가 자율로 호출할 수 있는 유일한 계층이며,
 * 여기서 나온 값은 행 데이터가 아니라 메타데이터이므로 사용자 동의 없이
 * LLM 컨텍스트에 들어갈 수 있다.
 */
export interface SchemaCapability {
  listSchemas(ctx: ExecutionContext): Promise<readonly SchemaInfo[]>
  listTables(ctx: ExecutionContext, schema: string): Promise<readonly TableInfo[]>
  describeTable(ctx: ExecutionContext, schema: string, table: string): Promise<TableDetail>
  listIndexes(
    ctx: ExecutionContext,
    schema: string,
    table: string,
  ): Promise<readonly IndexInfo[]>
  listForeignKeys(
    ctx: ExecutionContext,
    schema: string,
    table: string,
  ): Promise<readonly ForeignKeyInfo[]>
}
