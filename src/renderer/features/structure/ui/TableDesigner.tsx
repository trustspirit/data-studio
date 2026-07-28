import { useMemo, useState } from 'react'
import styled from 'styled-components'
import type { SqlEngineId } from '../../../../shared/types/connection'
import type { ColumnInfo, IndexInfo } from '../../../../shared/types/schema'
import type { TableSelection } from '../../../entities/schema-tree'
import { SqlCode } from '../../../entities/sql-lang'
import { Button, ErrorBanner, Input, NativeSelect } from '../../../shared/ui'
import {
  buildAddColumn,
  buildAddForeignKey,
  buildCreateIndex,
  buildCreateTable,
  buildDropColumn,
  buildDropIndex,
  buildDropTable,
  buildRenameColumn,
  buildRenameTable,
  supportsAddForeignKey,
  TYPE_SUGGESTIONS,
  validateAddColumn,
  validateCreateTable,
  validateDropColumn,
  validateDropIndex,
  validateDropTable,
  validateForeignKey,
  validateIndex,
  validateRenameColumn,
  validateRenameTable,
  type ColumnSpec,
  type FkAction,
  type TableFacts,
} from '../model/ddlBuilder'

const Wrap = styled.div`
  flex: 1;
  overflow: auto;
  padding: ${({ theme }) => theme.space.md};
  font-family: ${({ theme }) => theme.font.ui};
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.space.md};
`
const Title = styled.h3`
  margin: 0;
  font-size: ${({ theme }) => theme.fontSize.heading};
  color: ${({ theme }) => theme.color.text.primary};
`
const FieldRow = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.space.sm};
  flex-wrap: wrap;
`
const Label = styled.label`
  font-size: ${({ theme }) => theme.fontSize.label};
  color: ${({ theme }) => theme.color.text.dim};
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.space.xs};
`
const ColumnsGrid = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.space.xs};
`
const ColumnRow = styled.div`
  display: grid;
  grid-template-columns: 1.2fr 1.2fr 1fr auto auto auto auto;
  gap: ${({ theme }) => theme.space.xs};
  align-items: center;
`
const AddRow = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.space.xs};
`
const Check = styled.label`
  font-size: ${({ theme }) => theme.fontSize.label};
  color: ${({ theme }) => theme.color.text.dim};
  display: inline-flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
`
const IssueList = styled.ul`
  margin: 0;
  padding-left: ${({ theme }) => theme.space.lg};
  font-size: ${({ theme }) => theme.fontSize.body};
  color: ${({ theme }) => theme.color.intent.warning};
`
const Actions = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.space.sm};
`
const Danger = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.space.xs};
  padding: ${({ theme }) => theme.space.sm};
  border: 1px solid ${({ theme }) => theme.color.intent.danger};
  border-radius: ${({ theme }) => theme.radius.sm};
  font-size: ${({ theme }) => theme.fontSize.body};
  color: ${({ theme }) => theme.color.text.primary};

  code {
    font-family: ${({ theme }) => theme.font.mono};
    color: ${({ theme }) => theme.color.intent.warning};
  }
`

export type DesignerMode =
  | 'create'
  | 'fk'
  | 'index'
  | 'renameTable'
  | 'renameColumn'
  | 'addColumn'
  | 'dropColumn'
  | 'dropTable'
  | 'dropIndex'

/** 되돌릴 수 없는 모드. 대상 이름을 직접 입력받아야 실행이 열린다. */
const DESTRUCTIVE: ReadonlySet<DesignerMode> = new Set<DesignerMode>([
  'dropColumn',
  'dropTable',
  'dropIndex',
])

interface TableDesignerProps {
  dialect: SqlEngineId
  mode: DesignerMode
  /** 스키마 datalist 제안용 이름 목록. */
  schemas: readonly string[]
  /** fk/index 모드의 대상 테이블. create 모드는 schema만 시드로 쓴다. */
  selection: TableSelection | null
  /**
   * 선택된 테이블에서 읽어 온 구조. 컬럼·인덱스를 고르는 모드와 sqlite의
   * DROP COLUMN 사전 검사에 쓴다.
   */
  existing?: {
    readonly columns: readonly ColumnInfo[]
    readonly indexes: readonly IndexInfo[]
  }
  /** 컬럼/인덱스 행에서 바로 열었을 때 미리 고를 대상 이름. */
  initialTarget?: string
  /** 성공하면 null, 실패하면 사용자에게 보여줄 이유를 돌려준다. */
  onRun: (sql: string) => Promise<string | null>
  onClose: () => void
}

interface ColumnDraft extends ColumnSpec {
  readonly key: number
}

let colKey = 0
function emptyColumn(): ColumnDraft {
  colKey += 1
  return {
    key: colKey,
    name: '',
    type: '',
    notNull: false,
    primaryKey: false,
    defaultExpr: '',
    autoIncrement: false,
  }
}

/**
 * 방언에 맞는 자동 증가 PK 컬럼.
 *
 * sqlite가 `integer`인 것은 취향이 아니라 제약이다. rowid 별칭은 선언 타입이
 * 정확히 INTEGER일 때만 성립하고, `bigint`로 만들면 AUTOINCREMENT가 거부되거나
 * (PK만 걸린 경우) **오류 없이 id가 NULL로 들어간다.**
 */
function idColumn(dialect: SqlEngineId): ColumnDraft {
  colKey += 1
  return {
    key: colKey,
    name: 'id',
    type: dialect === 'sqlite' ? 'integer' : 'bigint',
    notNull: false,
    primaryKey: true,
    defaultExpr: '',
    autoIncrement: true,
  }
}

function splitColumns(raw: string): readonly string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '')
}

const FK_ACTIONS: readonly FkAction[] = ['NO ACTION', 'CASCADE', 'SET NULL', 'RESTRICT']

const MODE_TITLE: Record<DesignerMode, string> = {
  create: 'New Table',
  fk: 'Add Foreign Key',
  index: 'Add Index',
  renameTable: 'Rename Table',
  renameColumn: 'Rename Column',
  addColumn: 'Add Column',
  dropColumn: 'Drop Column',
  dropTable: 'Drop Table',
  dropIndex: 'Drop Index',
}

export function TableDesigner({
  dialect,
  mode,
  schemas,
  selection,
  existing,
  initialTarget,
  onRun,
  onClose,
}: TableDesignerProps) {
  const seedSchema = selection?.schema ?? schemas[0] ?? ''
  const existingColumns = existing?.columns ?? []
  const existingIndexes = existing?.indexes ?? []

  // create
  const [schema, setSchema] = useState(seedSchema)
  const [table, setTable] = useState('')
  const [columns, setColumns] = useState<readonly ColumnDraft[]>([emptyColumn()])
  // 프리셋으로 중복 id 컬럼을 만들 수 없어야 한다.
  const hasIdColumn = columns.some((column) => column.name.trim().toLowerCase() === 'id')
  // fk
  const [fkName, setFkName] = useState('')
  const [fkColumns, setFkColumns] = useState('')
  const [refSchema, setRefSchema] = useState(seedSchema)
  const [refTable, setRefTable] = useState('')
  const [refColumns, setRefColumns] = useState('')
  const [onDelete, setOnDelete] = useState<FkAction>('NO ACTION')
  // index
  const [indexName, setIndexName] = useState('')
  const [indexColumns, setIndexColumns] = useState('')
  const [unique, setUnique] = useState(false)
  // alter — 대상은 initialTarget으로 시드한다(컬럼/인덱스 행에서 바로 열 때).
  const [targetColumn, setTargetColumn] = useState(initialTarget ?? '')
  const [targetIndex, setTargetIndex] = useState(initialTarget ?? '')
  const [newName, setNewName] = useState('')
  const [addName, setAddName] = useState('')
  const [addType, setAddType] = useState('')
  const [addNotNull, setAddNotNull] = useState(false)
  const [addDefault, setAddDefault] = useState('')
  /** 파괴적 모드의 확인 입력. 대상 이름과 정확히 같아야 실행이 열린다. */
  const [confirmText, setConfirmText] = useState('')

  const [busy, setBusy] = useState(false)
  const [runError, setRunError] = useState<string | null>(null)

  const patchColumn = (key: number, patch: Partial<ColumnSpec>) => {
    setColumns((cols) => cols.map((c) => (c.key === key ? { ...c, ...patch } : c)))
  }

  const { sql, issues } = useMemo(() => {
    if (mode === 'create') {
      const spec = { schema, table, columns }
      return { sql: buildCreateTable(dialect, spec), issues: validateCreateTable(dialect, spec) }
    }
    const target = { schema: selection?.schema ?? '', table: selection?.table ?? '' }
    if (mode === 'fk') {
      if (!supportsAddForeignKey(dialect))
        return { sql: '', issues: ['이 엔진은 ALTER TABLE로 FK를 추가할 수 없습니다.'] }
      const spec = {
        ...target,
        constraintName: fkName,
        columns: splitColumns(fkColumns),
        refSchema,
        refTable,
        refColumns: splitColumns(refColumns),
        onDelete,
      }
      return { sql: buildAddForeignKey(dialect, spec), issues: validateForeignKey(spec) }
    }
    if (mode === 'renameTable') {
      const spec = { ...target, newName }
      return { sql: buildRenameTable(dialect, spec), issues: validateRenameTable(spec) }
    }
    if (mode === 'renameColumn') {
      const spec = { ...target, column: targetColumn, newName }
      return { sql: buildRenameColumn(dialect, spec), issues: validateRenameColumn(spec) }
    }
    if (mode === 'addColumn') {
      const spec = {
        ...target,
        name: addName,
        type: addType,
        notNull: addNotNull,
        defaultExpr: addDefault,
      }
      return { sql: buildAddColumn(dialect, spec), issues: validateAddColumn(dialect, spec) }
    }
    if (mode === 'dropColumn') {
      const spec = { ...target, column: targetColumn }
      const facts: TableFacts = {
        pkColumns: existingColumns
          .filter((c) => c.primaryKeyOrdinal !== null)
          .map((c) => c.name),
        indexedColumns: existingIndexes.flatMap((ix) => ix.columns),
      }
      return {
        sql: buildDropColumn(dialect, spec),
        issues: validateDropColumn(dialect, spec, facts),
      }
    }
    if (mode === 'dropTable') {
      return { sql: buildDropTable(dialect, target), issues: validateDropTable(target) }
    }
    if (mode === 'dropIndex') {
      const spec = { ...target, indexName: targetIndex }
      return { sql: buildDropIndex(dialect, spec), issues: validateDropIndex(spec) }
    }
    const spec = { ...target, indexName, columns: splitColumns(indexColumns), unique }
    return { sql: buildCreateIndex(dialect, spec), issues: validateIndex(spec) }
  }, [
    mode,
    dialect,
    selection,
    schema,
    table,
    columns,
    fkName,
    fkColumns,
    refSchema,
    refTable,
    refColumns,
    onDelete,
    indexName,
    indexColumns,
    unique,
    newName,
    targetColumn,
    targetIndex,
    addName,
    addType,
    addNotNull,
    addDefault,
    existingColumns,
    existingIndexes,
  ])

  /**
   * 파괴적 모드에서 사용자가 입력해야 하는 대상 이름. 확인 절차의 기준이다.
   * 실제 이름을 그대로 담는다 — 실행되는 문장도 이 이름을 쓴다.
   */
  const confirmTarget =
    mode === 'dropColumn'
      ? targetColumn
      : mode === 'dropIndex'
        ? targetIndex
        : mode === 'dropTable'
          ? (selection?.table ?? '')
          : ''
  const needsConfirm = DESTRUCTIVE.has(mode)
  /**
   * 대상과 입력을 **같은 방식으로** 다룬다.
   *
   * 한쪽만 trim하면 이름에 공백이 있는 대상은 확인이 영구히 불가능해진다 —
   * pg는 `"  x  "`를 유효한 식별자로 받는다. 양쪽을 trim하면 그런 이름도
   * 안쪽 이름을 쳐서 확인할 수 있고, 다른 이름은 여전히 막힌다.
   *
   * 이 절차는 대상의 신원을 증명받는 것이 아니다(행을 눌러 이미 골랐다).
   * 실수로 누르는 것을 막는 속도 방지턱이므로 이 정도 관용이 맞다.
   */
  const confirmed =
    !needsConfirm ||
    (confirmTarget.trim() !== '' && confirmText.trim() === confirmTarget.trim())

  const run = () => {
    setBusy(true)
    setRunError(null)
    void (async () => {
      const failure = await onRun(sql)
      if (failure !== null) {
        setRunError(failure)
        setBusy(false)
        return
      }
      onClose()
    })()
  }

  const typeListId = `ddl-types-${dialect}`

  return (
    <Wrap data-testid="table-designer">
      <Title>
        {MODE_TITLE[mode]}
        {mode !== 'create' && selection !== null && ` — ${selection.schema}.${selection.table}`}
      </Title>

      {mode === 'create' && (
        <>
          <FieldRow>
            <Label>
              Schema
              <Input
                data-testid="ddl-schema"
                list="ddl-schemas"
                value={schema}
                onChange={(e) => setSchema(e.target.value)}
                placeholder="(없으면 비워두기)"
              />
            </Label>
            <datalist id="ddl-schemas">
              {schemas.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
            <Label>
              Table
              <Input
                data-testid="ddl-table"
                value={table}
                onChange={(e) => setTable(e.target.value)}
                placeholder="table_name"
              />
            </Label>
          </FieldRow>
          <ColumnsGrid>
            {columns.map((c, i) => (
              <ColumnRow key={c.key}>
                <Input
                  data-testid={`ddl-col-name-${i}`}
                  value={c.name}
                  onChange={(e) => patchColumn(c.key, { name: e.target.value })}
                  placeholder="column"
                />
                <Input
                  data-testid={`ddl-col-type-${i}`}
                  list={typeListId}
                  value={c.type}
                  onChange={(e) => patchColumn(c.key, { type: e.target.value })}
                  placeholder="type"
                />
                <Input
                  data-testid={`ddl-col-default-${i}`}
                  value={c.defaultExpr ?? ''}
                  disabled={c.autoIncrement}
                  onChange={(e) => patchColumn(c.key, { defaultExpr: e.target.value })}
                  placeholder={c.autoIncrement ? '자동 증가' : 'DEFAULT (선택)'}
                />
                <Check>
                  <input
                    type="checkbox"
                    checked={c.notNull}
                    onChange={(e) => patchColumn(c.key, { notNull: e.target.checked })}
                  />
                  NOT NULL
                </Check>
                <Check>
                  <input
                    type="checkbox"
                    data-testid={`ddl-col-pk-${i}`}
                    checked={c.primaryKey}
                    onChange={(e) => patchColumn(c.key, { primaryKey: e.target.checked })}
                  />
                  PK
                </Check>
                <Check>
                  <input
                    type="checkbox"
                    data-testid={`ddl-col-auto-${i}`}
                    checked={c.autoIncrement}
                    onChange={(e) =>
                      // 켤 때 DEFAULT를 함께 지운다. 두 값은 함께 있을 수 없고
                      // (엔진이 거부한다), 남겨 두면 검증이 계속 막는다.
                      patchColumn(
                        c.key,
                        e.target.checked
                          ? { autoIncrement: true, defaultExpr: '' }
                          : { autoIncrement: false },
                      )
                    }
                  />
                  AUTO
                </Check>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={columns.length === 1}
                  onClick={() => setColumns((cols) => cols.filter((x) => x.key !== c.key))}
                >
                  ✕
                </Button>
              </ColumnRow>
            ))}
            <datalist id={typeListId}>
              {TYPE_SUGGESTIONS[dialect].map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
            <AddRow>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                data-testid="ddl-add-id"
                disabled={hasIdColumn}
                title={hasIdColumn ? 'ID 컬럼이 이미 있어 추가할 수 없습니다.' : undefined}
                onClick={() =>
                  setColumns((cols) => [
                    idColumn(dialect),
                    ...cols.filter((c) => c.name.trim() !== '' || c.type.trim() !== ''),
                  ])
                }
              >
                + ID
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                data-testid="ddl-add-column"
                onClick={() => setColumns((cols) => [...cols, emptyColumn()])}
              >
                + Column
              </Button>
            </AddRow>
          </ColumnsGrid>
        </>
      )}

      {mode === 'fk' && (
        <>
          <FieldRow>
            <Label>
              Constraint
              <Input
                value={fkName}
                onChange={(e) => setFkName(e.target.value)}
                placeholder="(선택 — 비우면 자동 이름)"
              />
            </Label>
            <Label>
              Columns
              <Input
                data-testid="ddl-fk-columns"
                value={fkColumns}
                onChange={(e) => setFkColumns(e.target.value)}
                placeholder="col1, col2"
              />
            </Label>
          </FieldRow>
          <FieldRow>
            <Label>
              Ref schema
              <Input
                list="ddl-schemas"
                value={refSchema}
                onChange={(e) => setRefSchema(e.target.value)}
              />
            </Label>
            <datalist id="ddl-schemas">
              {schemas.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
            <Label>
              Ref table
              <Input
                data-testid="ddl-fk-ref-table"
                value={refTable}
                onChange={(e) => setRefTable(e.target.value)}
              />
            </Label>
            <Label>
              Ref columns
              <Input
                data-testid="ddl-fk-ref-columns"
                value={refColumns}
                onChange={(e) => setRefColumns(e.target.value)}
                placeholder="id"
              />
            </Label>
            <Label>
              ON DELETE
              <NativeSelect
                value={onDelete}
                onChange={(e) => setOnDelete(e.target.value as FkAction)}
              >
                {FK_ACTIONS.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </NativeSelect>
            </Label>
          </FieldRow>
        </>
      )}

      {mode === 'index' && (
        <FieldRow>
          <Label>
            Name
            <Input
              data-testid="ddl-index-name"
              value={indexName}
              onChange={(e) => setIndexName(e.target.value)}
              placeholder="idx_table_col"
            />
          </Label>
          <Label>
            Columns
            <Input
              data-testid="ddl-index-columns"
              value={indexColumns}
              onChange={(e) => setIndexColumns(e.target.value)}
              placeholder="col1, col2"
            />
          </Label>
          <Check>
            <input type="checkbox" checked={unique} onChange={(e) => setUnique(e.target.checked)} />
            UNIQUE
          </Check>
        </FieldRow>
      )}

      {(mode === 'renameTable' || mode === 'renameColumn') && (
        <FieldRow>
          {mode === 'renameColumn' && (
            <Label>
              Column
              <NativeSelect
                data-testid="ddl-target-column"
                value={targetColumn}
                onChange={(e) => setTargetColumn(e.target.value)}
              >
                <option value="">(고르세요)</option>
                {existingColumns.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </NativeSelect>
            </Label>
          )}
          <Label>
            New name
            <Input
              data-testid="ddl-new-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={mode === 'renameTable' ? 'new_table_name' : 'new_column_name'}
            />
          </Label>
        </FieldRow>
      )}

      {mode === 'addColumn' && (
        <FieldRow>
          <Label>
            Name
            <Input
              data-testid="ddl-add-name"
              value={addName}
              onChange={(e) => setAddName(e.target.value)}
              placeholder="column"
            />
          </Label>
          <Label>
            Type
            <Input
              data-testid="ddl-add-type"
              list={typeListId}
              value={addType}
              onChange={(e) => setAddType(e.target.value)}
              placeholder="type"
            />
          </Label>
          <Label>
            DEFAULT
            <Input
              data-testid="ddl-add-default"
              value={addDefault}
              onChange={(e) => setAddDefault(e.target.value)}
              placeholder={addNotNull ? '기존 행에 채울 값 (필수)' : 'DEFAULT (선택)'}
            />
          </Label>
          <Check>
            <input
              type="checkbox"
              data-testid="ddl-add-notnull"
              checked={addNotNull}
              onChange={(e) => setAddNotNull(e.target.checked)}
            />
            NOT NULL
          </Check>
        </FieldRow>
      )}

      {mode === 'dropColumn' && (
        <FieldRow>
          <Label>
            Column
            <NativeSelect
              data-testid="ddl-target-column"
              value={targetColumn}
              onChange={(e) => {
                setTargetColumn(e.target.value)
                setConfirmText('')
              }}
            >
              <option value="">(고르세요)</option>
              {existingColumns.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
          </Label>
        </FieldRow>
      )}

      {mode === 'dropIndex' && (
        <FieldRow>
          <Label>
            Index
            <NativeSelect
              data-testid="ddl-target-index"
              value={targetIndex}
              onChange={(e) => {
                setTargetIndex(e.target.value)
                setConfirmText('')
              }}
            >
              <option value="">(고르세요)</option>
              {existingIndexes.map((ix) => (
                <option key={ix.name} value={ix.name}>
                  {ix.name}
                </option>
              ))}
            </NativeSelect>
          </Label>
        </FieldRow>
      )}

      {issues.length > 0 ? (
        <IssueList data-testid="ddl-issues">
          {issues.map((it) => (
            <li key={it}>{it}</li>
          ))}
        </IssueList>
      ) : (
        <SqlCode engine={dialect} code={sql} data-testid="ddl-preview" />
      )}

      {needsConfirm && issues.length === 0 && confirmTarget !== '' && (
        <Danger data-testid="ddl-confirm-block">
          <strong>되돌릴 수 없습니다.</strong>
          {mode === 'dropColumn' && dialect === 'postgres' && (
            <span> 이 컬럼만 쓰는 인덱스도 함께 사라집니다.</span>
          )}
          <Label>
            실행하려면 <code>{confirmTarget}</code> 을 입력하세요
            <Input
              data-testid="ddl-confirm"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={confirmTarget}
            />
          </Label>
        </Danger>
      )}
      {runError !== null && <ErrorBanner>{runError}</ErrorBanner>}

      <Actions>
        <Button
          type="button"
          data-testid="ddl-run"
          disabled={busy || issues.length > 0 || !confirmed}
          onClick={run}
        >
          {busy ? '실행 중…' : 'Run SQL'}
        </Button>
        <Button type="button" variant="ghost" data-testid="ddl-cancel" onClick={onClose}>
          Cancel
        </Button>
      </Actions>
    </Wrap>
  )
}
