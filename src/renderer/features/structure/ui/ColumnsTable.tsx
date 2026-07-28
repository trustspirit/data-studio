import styled from 'styled-components'
import type { ColumnInfo } from '../../../../shared/types/schema'
import { Badge, Button } from '../../../shared/ui'

const Table = styled.table`
  width: 100%;
  border-collapse: collapse;
  font-family: ${({ theme }) => theme.font.ui};
  font-size: ${({ theme }) => theme.fontSize.body};
  th, td {
    text-align: left;
    padding: 4px 10px;
    border-bottom: 1px solid ${({ theme }) => theme.color.border.soft};
  }
  th {
    color: ${({ theme }) => theme.color.text.dim};
    font-weight: 600;
  }
`
const RowActions = styled.td`
  white-space: nowrap;
  text-align: right;
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
}

export function ColumnsTable({ columns, onRename, onDrop }: ColumnsTableProps) {
  const editable = onRename !== undefined || onDrop !== undefined
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
