import styled from 'styled-components'
import type { IndexInfo } from '../../../../shared/types/schema'
import { Button, DataTable as Table } from '../../../shared/ui'


const Empty = styled.div`
  padding: 6px 10px;
  color: ${({ theme }) => theme.color.text.faint};
  font-size: ${({ theme }) => theme.fontSize.body};
`

const RowActions = styled.td`
  white-space: nowrap;
  text-align: right;
`

export function IndexList({
  indexes,
  onDrop,
}: {
  indexes: readonly IndexInfo[]
  onDrop?: (indexName: string) => void
}) {
  if (indexes.length === 0) return <Empty>인덱스 없음</Empty>
  return (
    <Table>
      <thead>
        <tr>
          <th>Name</th>
          <th>Columns</th>
          <th>Unique</th>
          <th>Size</th>
          {onDrop !== undefined && <th />}
        </tr>
      </thead>
      <tbody>
        {indexes.map((i) => (
          <tr key={i.name}>
            <td>{i.name}</td>
            <td>({i.columns.join(', ')})</td>
            <td>{i.unique ? 'UNIQUE' : ''}</td>
            <td>{i.sizeBytes !== null ? `${i.sizeBytes} B` : ''}</td>
            {onDrop !== undefined && (
              <RowActions>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  data-testid={`index-drop-${i.name}`}
                  onClick={() => onDrop(i.name)}
                >
                  Drop
                </Button>
              </RowActions>
            )}
          </tr>
        ))}
      </tbody>
    </Table>
  )
}
