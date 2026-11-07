import styled from 'styled-components'
import type { ColumnInfo } from '../../../../shared/types/schema'
import { Badge, Button, DataTable as Table } from '../../../shared/ui'

const RowActions = styled.td`
  white-space: nowrap;
  text-align: right;
`
const ColumnList = styled.div`
  article {
    padding: 12px 14px;
    border-bottom: 1px solid ${({ theme }) => theme.color.border.soft};
  }
  article:hover { background: ${({ theme }) => theme.color.row.hover}; }
  header { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
  strong { font-family: ${({ theme }) => theme.font.mono}; font-size: ${({ theme }) => theme.fontSize.label}; overflow-wrap: anywhere; }
  p { margin: 0; color: ${({ theme }) => theme.color.text.dim}; font-family: ${({ theme }) => theme.font.mono}; font-size: 12px; overflow-wrap: anywhere; line-height: 1.7; }
  small { color: ${({ theme }) => theme.color.text.faint}; font-family: ${({ theme }) => theme.font.ui}; }
  .column-actions { display: flex; gap: 4px; margin-top: 6px; }
`

/**
 * 컬럼 이름 변경·삭제를 컬럼 행 옆에 둔다.
 *
 * 툴바에만 두면 "어떤 컬럼에 대한 동작인가"를 사용자가 폼 안에서 다시 골라야
 * 한다. 대상 옆에 두면 고르는 단계가 사라지고, 무엇에 영향이 가는지도 분명하다.
 */
interface ColumnsTableProps {
  columns: readonly ColumnInfo[]
  onRename?: (column: string) => void
  onDrop?: (column: string) => void
  compact?: boolean
}

export function ColumnsTable({ columns, onRename, onDrop, compact = false }: ColumnsTableProps) {
  const editable = onRename !== undefined || onDrop !== undefined
  if (compact) return <ColumnList aria-label="컬럼 목록">
    {columns.map((column) => <article key={column.name}>
      <header><strong>{column.name}</strong>{column.primaryKeyOrdinal !== null && <Badge tone="accent">PK{column.primaryKeyOrdinal}</Badge>}</header>
      <p>{column.type} <small>· {column.nullable ? 'Nullable' : 'NOT NULL'}</small></p>
      {column.defaultValue !== null && <p title={column.defaultValue}><small>Default </small>{column.defaultValue}</p>}
      {editable && <div className="column-actions">
        {onRename !== undefined && <Button variant="ghost" size="sm" data-testid={`col-rename-${column.name}`} onClick={() => onRename(column.name)}>Rename</Button>}
        {onDrop !== undefined && <Button variant="ghost" size="sm" data-testid={`col-drop-${column.name}`} onClick={() => onDrop(column.name)}>Drop</Button>}
      </div>}
    </article>)}
  </ColumnList>
  return (
    <Table>
      <thead>
        <tr>
          <th>Name</th>
          <th>Type</th>
          <th>Nullable</th>
          <th>Default</th>
          <th>Key</th>
          {editable && <th />}
        </tr>
      </thead>
      <tbody>
        {columns.map((c) => (
          <tr key={c.name}>
            <td>{c.name}</td>
            <td>{c.type}</td>
            <td>{c.nullable ? 'YES' : 'NO'}</td>
            <td>{c.defaultValue ?? ''}</td>
            <td>{c.primaryKeyOrdinal !== null ? <Badge tone="accent">PK{c.primaryKeyOrdinal}</Badge> : ''}</td>
            {editable && (
              <RowActions>
                {onRename !== undefined && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    data-testid={`col-rename-${c.name}`}
                    onClick={() => onRename(c.name)}
                  >
                    Rename
                  </Button>
                )}
                {onDrop !== undefined && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    data-testid={`col-drop-${c.name}`}
                    onClick={() => onDrop(c.name)}
                  >
                    Drop
                  </Button>
                )}
              </RowActions>
            )}
          </tr>
        ))}
      </tbody>
    </Table>
  )
}
