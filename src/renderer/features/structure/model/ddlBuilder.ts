import type { SqlEngineId } from '../../../../shared/types/connection'

/**
 * 방언별 DDL 문장 생성기 — 테이블 디자이너의 유일한 SQL 조립 지점.
 *
 * 순수 함수로만 구성한다: 입력 스펙 → SQL 문자열. 실행·검증·상태는 UI와
 * executor의 몫이다. 사용자는 생성된 SQL을 미리보기로 그대로 확인한 뒤
 * 기존 `operation:run`(kind: 'sql')으로 실행한다 — 새 도메인 연산을
 * 엔진마다 추가하는 대신 이미 검증된 사용자 SQL 경로를 재사용한다.
 */

export interface ColumnSpec {
  readonly name: string
  readonly type: string
  readonly notNull: boolean
  readonly primaryKey: boolean
  /** 원문 SQL 표현식(예: `0`, `'draft'`, `now()`). 비면 DEFAULT 절 생략. */
  readonly defaultExpr?: string
}

export interface CreateTableSpec {
  /** 빈 문자열·undefined면 스키마 한정 없이 테이블명만 쓴다(sqlite 등). */
  readonly schema?: string
  readonly table: string
  readonly columns: readonly ColumnSpec[]
}

export type FkAction = 'NO ACTION' | 'CASCADE' | 'SET NULL' | 'RESTRICT'

export interface ForeignKeySpec {
  readonly schema?: string
  readonly table: string
  /** 비면 CONSTRAINT 절을 생략하고 엔진이 이름을 정하게 둔다. */
  readonly constraintName?: string
  readonly columns: readonly string[]
  readonly refSchema?: string
  readonly refTable: string
  readonly refColumns: readonly string[]
  readonly onDelete?: FkAction
}

export interface IndexSpec {
  readonly schema?: string
  readonly table: string
  readonly indexName: string
  readonly columns: readonly string[]
  readonly unique: boolean
}

/**
 * 식별자 인용. postgres/sqlite는 큰따옴표, mysql/mariadb는 백틱.
 * 내부의 인용 문자는 두 번 적어 이스케이프한다 — 사용자가 어떤 이름을
 * 입력해도 식별자 경계를 깨고 나올 수 없게.
 */
export function quoteIdent(dialect: SqlEngineId, name: string): string {
  if (dialect === 'mysql' || dialect === 'mariadb') return '`' + name.replaceAll('`', '``') + '`'
  return '"' + name.replaceAll('"', '""') + '"'
}

function qualified(dialect: SqlEngineId, schema: string | undefined, table: string): string {
  const t = quoteIdent(dialect, table)
  return schema !== undefined && schema !== '' ? `${quoteIdent(dialect, schema)}.${t}` : t
}

/** sqlite는 `ALTER TABLE … ADD CONSTRAINT`를 지원하지 않는다 — FK는 테이블 생성 시에만. */
export function supportsAddForeignKey(dialect: SqlEngineId): boolean {
  return dialect !== 'sqlite'
}

export function buildCreateTable(dialect: SqlEngineId, spec: CreateTableSpec): string {
  const lines = spec.columns.map((c) => {
    let line = `  ${quoteIdent(dialect, c.name)} ${c.type.trim()}`
    if (c.defaultExpr !== undefined && c.defaultExpr.trim() !== '')
      line += ` DEFAULT ${c.defaultExpr.trim()}`
    if (c.notNull) line += ' NOT NULL'
    return line
  })
  const pk = spec.columns.filter((c) => c.primaryKey)
  if (pk.length > 0)
    lines.push(`  PRIMARY KEY (${pk.map((c) => quoteIdent(dialect, c.name)).join(', ')})`)
  return `CREATE TABLE ${qualified(dialect, spec.schema, spec.table)} (\n${lines.join(',\n')}\n)`
}

export function buildAddForeignKey(dialect: SqlEngineId, spec: ForeignKeySpec): string {
  if (!supportsAddForeignKey(dialect))
    throw new Error(`${dialect} does not support ALTER TABLE … ADD FOREIGN KEY`)
  const cols = spec.columns.map((c) => quoteIdent(dialect, c)).join(', ')
  const refCols = spec.refColumns.map((c) => quoteIdent(dialect, c)).join(', ')
  const constraint =
    spec.constraintName !== undefined && spec.constraintName !== ''
      ? `CONSTRAINT ${quoteIdent(dialect, spec.constraintName)} `
      : ''
  let sql =
    `ALTER TABLE ${qualified(dialect, spec.schema, spec.table)}\n` +
    `  ADD ${constraint}FOREIGN KEY (${cols})\n` +
    `  REFERENCES ${qualified(dialect, spec.refSchema, spec.refTable)} (${refCols})`
  if (spec.onDelete !== undefined && spec.onDelete !== 'NO ACTION')
    sql += `\n  ON DELETE ${spec.onDelete}`
  return sql
}

export function buildCreateIndex(dialect: SqlEngineId, spec: IndexSpec): string {
  const unique = spec.unique ? 'UNIQUE ' : ''
  // postgres/sqlite에서 인덱스명은 스키마에 귀속된다 — 이름 자체는 한정하지
  // 않고 ON 절의 테이블만 한정한다(모든 방언에서 유효한 공통형).
  const name = quoteIdent(dialect, spec.indexName)
  const cols = spec.columns.map((c) => quoteIdent(dialect, c)).join(', ')
  return `CREATE ${unique}INDEX ${name} ON ${qualified(dialect, spec.schema, spec.table)} (${cols})`
}

/** 폼 datalist용 타입 제안. 자유 입력을 막지 않는다 — 제안일 뿐이다. */
export const TYPE_SUGGESTIONS: Record<SqlEngineId, readonly string[]> = {
  postgres: [
    'bigint',
    'integer',
    'smallint',
    'serial',
    'bigserial',
    'text',
    'varchar(255)',
    'boolean',
    'numeric(12,2)',
    'timestamptz',
    'date',
    'uuid',
    'jsonb',
    'bytea',
  ],
  mysql: [
    'bigint',
    'int',
    'smallint',
    'varchar(255)',
    'text',
    'tinyint(1)',
    'decimal(12,2)',
    'datetime',
    'timestamp',
    'date',
    'json',
    'blob',
  ],
  mariadb: [
    'bigint',
    'int',
    'smallint',
    'varchar(255)',
    'text',
    'tinyint(1)',
    'decimal(12,2)',
    'datetime',
    'timestamp',
    'date',
    'json',
    'blob',
  ],
  sqlite: ['integer', 'text', 'real', 'blob', 'numeric'],
}

export type DdlIssue = string

/** 폼 검증. 빌더는 총함수로 두고(주어진 대로 인용), 실행 가능 여부는 여기서 판정한다. */
export function validateCreateTable(spec: CreateTableSpec): readonly DdlIssue[] {
  const issues: DdlIssue[] = []
  if (spec.table.trim() === '') issues.push('테이블 이름을 입력하세요.')
  if (spec.columns.length === 0) issues.push('컬럼을 하나 이상 추가하세요.')
  spec.columns.forEach((c, i) => {
    if (c.name.trim() === '') issues.push(`${i + 1}번째 컬럼 이름이 비어 있습니다.`)
    if (c.type.trim() === '') issues.push(`${i + 1}번째 컬럼 타입이 비어 있습니다.`)
  })
  const names = spec.columns.map((c) => c.name.trim()).filter((n) => n !== '')
  if (new Set(names).size !== names.length) issues.push('컬럼 이름이 중복되었습니다.')
  return issues
}

export function validateForeignKey(spec: ForeignKeySpec): readonly DdlIssue[] {
  const issues: DdlIssue[] = []
  if (spec.columns.length === 0 || spec.columns.every((c) => c.trim() === ''))
    issues.push('원본 컬럼을 입력하세요.')
  if (spec.refTable.trim() === '') issues.push('참조 테이블을 입력하세요.')
  if (spec.refColumns.length === 0 || spec.refColumns.every((c) => c.trim() === ''))
    issues.push('참조 컬럼을 입력하세요.')
  if (spec.columns.length !== spec.refColumns.length)
    issues.push('원본 컬럼 수와 참조 컬럼 수가 다릅니다.')
  return issues
}

export function validateIndex(spec: IndexSpec): readonly DdlIssue[] {
  const issues: DdlIssue[] = []
  if (spec.indexName.trim() === '') issues.push('인덱스 이름을 입력하세요.')
  if (spec.columns.length === 0 || spec.columns.every((c) => c.trim() === ''))
    issues.push('컬럼을 입력하세요.')
  return issues
}
