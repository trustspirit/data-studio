/**
 * 스키마 인트로스펙션이 돌려주는 메타데이터 타입.
 *
 * main의 드라이버와 renderer의 Structure 뷰가 함께 쓴다. IPC를 건너므로
 * (`structuredClone` 가능) shared에 둔다 — renderer는 `@main`을 import할 수 없다.
 */

export interface SchemaInfo {
  readonly name: string
}

/**
 * `listTables`가 돌려주는 객체의 종류.
 *
 * - `'table'`: 일반 base table. 쓰기 가능.
 * - `'view'`: 뷰. 대부분의 엔진에서 직접 쓰기가 안 되거나 제한적이다 — AI
 *   계층이 이를 base table과 같게 취급하면 안 된다.
 * - `'materialized_view'`: materialized view. 읽기 전용이고, 내용이 마지막
 *   REFRESH 시점에 멈춰 있을 수 있다.
 *
 * foreign table과 partition은 아직 이 union에 없다 — 이를 구분해야 하는
 * 드라이버가 실제로 나오기 전까지는 값을 예측해서 늘리지 않는다.
 */
export type TableKind = 'table' | 'view' | 'materialized_view'

export interface TableInfo {
  readonly schema: string
  readonly name: string
  readonly kind: TableKind
  /** 추정 행 수. 엔진이 제공하지 않으면 null. */
  readonly estimatedRows: number | null
}

export interface ColumnInfo {
  readonly name: string
  readonly type: string
  readonly nullable: boolean
  readonly defaultValue: string | null
  /**
   * 복합 기본키에서 이 컬럼의 위치(1부터). 기본키가 아니면 null.
   *
   * boolean이 아닌 이유: 복합 PK는 **순서가 의미를 갖는다.** 행 편집이 만드는
   * `WHERE` 절과 keyset 페이지네이션의 정렬이 둘 다 키 순서를 따라야 하는데,
   * boolean만 있으면 그 순서를 복원할 방법이 없다.
   */
  readonly primaryKeyOrdinal: number | null
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
