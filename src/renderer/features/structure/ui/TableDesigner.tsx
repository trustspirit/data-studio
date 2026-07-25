import { useMemo, useState } from 'react'
import styled from 'styled-components'
import type { SqlEngineId } from '../../../../shared/types/connection'
import type { TableSelection } from '../../../entities/schema-tree'
import { Button, ErrorBanner, Input, NativeSelect } from '../../../shared/ui'
import {
  buildAddForeignKey,
  buildCreateIndex,
  buildCreateTable,
  supportsAddForeignKey,
  TYPE_SUGGESTIONS,
  validateCreateTable,
  validateForeignKey,
  validateIndex,
  type ColumnSpec,
  type FkAction,
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
  font-size: ${({ theme }) => theme.fontSize.md};
  color: ${({ theme }) => theme.color.text};
`
const FieldRow = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.space.sm};
  flex-wrap: wrap;
`
const Label = styled.label`
  font-size: ${({ theme }) => theme.fontSize.sm};
  color: ${({ theme }) => theme.color.textDim};
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
  grid-template-columns: 1.2fr 1.2fr 1fr auto auto auto;
  gap: ${({ theme }) => theme.space.xs};
  align-items: center;
`
const Check = styled.label`
  font-size: ${({ theme }) => theme.fontSize.xs};
  color: ${({ theme }) => theme.color.textDim};
  display: inline-flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
`
const Preview = styled.pre`
  margin: 0;
  padding: ${({ theme }) => theme.space.sm};
  border: 1px solid ${({ theme }) => theme.color.border};
  border-radius: ${({ theme }) => theme.radius.md};
  background: ${({ theme }) => theme.color.gridBg};
  color: ${({ theme }) => theme.color.text};
  font-family: ${({ theme }) => theme.font.mono};
  font-size: ${({ theme }) => theme.fontSize.sm};
  white-space: pre-wrap;
  word-break: break-all;
`
const IssueList = styled.ul`
  margin: 0;
  padding-left: ${({ theme }) => theme.space.lg};
  font-size: ${({ theme }) => theme.fontSize.sm};
  color: ${({ theme }) => theme.color.orange};
`
const Actions = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.space.sm};
`

export type DesignerMode = 'create' | 'fk' | 'index'

interface TableDesignerProps {
  dialect: SqlEngineId
  mode: DesignerMode
  /** 스키마 datalist 제안용 이름 목록. */
  schemas: readonly string[]
  /** fk/index 모드의 대상 테이블. create 모드는 schema만 시드로 쓴다. */
  selection: TableSelection | null
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
}

export function TableDesigner({
  dialect,
  mode,
  schemas,
  selection,
  onRun,
  onClose,
}: TableDesignerProps) {
  const seedSchema = selection?.schema ?? schemas[0] ?? ''

  // create
  const [schema, setSchema] = useState(seedSchema)
  const [table, setTable] = useState('')
  const [columns, setColumns] = useState<readonly ColumnDraft[]>([emptyColumn()])
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
  ])

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
                  value={c.defaultExpr ?? ''}
                  onChange={(e) => patchColumn(c.key, { defaultExpr: e.target.value })}
                  placeholder="DEFAULT (선택)"
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
                <Button
                  type="button"
                  variant="secondary"
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
            <div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                data-testid="ddl-add-column"
                onClick={() => setColumns((cols) => [...cols, emptyColumn()])}
              >
                + Column
              </Button>
            </div>
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

      {issues.length > 0 ? (
        <IssueList data-testid="ddl-issues">
          {issues.map((it) => (
            <li key={it}>{it}</li>
          ))}
        </IssueList>
      ) : (
        <Preview data-testid="ddl-preview">{sql}</Preview>
      )}
      {runError !== null && <ErrorBanner>{runError}</ErrorBanner>}

      <Actions>
        <Button
          type="button"
          data-testid="ddl-run"
          disabled={busy || issues.length > 0}
          onClick={run}
        >
          {busy ? '실행 중…' : 'Run SQL'}
        </Button>
        <Button type="button" variant="secondary" data-testid="ddl-cancel" onClick={onClose}>
          Cancel
        </Button>
      </Actions>
    </Wrap>
  )
}
