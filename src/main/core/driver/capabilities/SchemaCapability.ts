import type { ExecutionContext } from '../ExecutionContext'
import type {
  SchemaInfo,
  TableInfo,
  ColumnInfo,
  TableDetail,
  IndexInfo,
  ForeignKeyInfo,
} from '../../../../shared/types/schema'

// 메타데이터 타입은 shared에 있다(IPC wire). 여기서 재-export해 기존
// `@main/.../SchemaCapability`에서 타입을 가져오던 코드가 무변경으로 통과한다.
export type {
  SchemaInfo,
  TableKind,
  TableInfo,
  ColumnInfo,
  TableDetail,
  IndexInfo,
  ForeignKeyInfo,
} from '../../../../shared/types/schema'

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
