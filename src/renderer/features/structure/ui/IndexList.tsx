import styled from 'styled-components'
import type { IndexInfo } from '../../../../shared/types/schema'

const Table = styled.table`
  width: 100%;
  border-collapse: collapse;
  font: ${({ theme }) => theme.font.ui};
  font-size: 12px;
  th, td {
    text-align: left;
    padding: 4px 10px;
    border-bottom: 1px solid ${({ theme }) => theme.color.borderSoft};
  }
  th {
    color: ${({ theme }) => theme.color.textDim};
    font-weight: 600;
  }
`

const Empty = styled.div`
  padding: 6px 10px;
  color: ${({ theme }) => theme.color.textFaint};
  font-size: 12px;
`

export function IndexList({ indexes }: { indexes: readonly IndexInfo[] }) {
  if (indexes.length === 0) return <Empty>인덱스 없음</Empty>
  return (
    <Table>
      <thead>
        <tr>
          <th>Name</th>
          <th>Columns</th>
          <th>Unique</th>
          <th>Size</th>
        </tr>
      </thead>
      <tbody>
        {indexes.map((i) => (
          <tr key={i.name}>
            <td>{i.name}</td>
            <td>({i.columns.join(', ')})</td>
            <td>{i.unique ? 'UNIQUE' : ''}</td>
            <td>{i.sizeBytes !== null ? `${i.sizeBytes} B` : ''}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  )
}
