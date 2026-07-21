import styled from 'styled-components'
import type { ColumnInfo } from '../../../../shared/types/schema'

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
const Tag = styled.span`
  color: ${({ theme }) => theme.color.green};
  font-weight: 600;
`

export function ColumnsTable({ columns }: { columns: readonly ColumnInfo[] }) {
  return (
    <Table>
      <thead>
        <tr>
          <th>Name</th>
          <th>Type</th>
          <th>Nullable</th>
          <th>Default</th>
          <th>Key</th>
        </tr>
      </thead>
      <tbody>
        {columns.map((c) => (
          <tr key={c.name}>
            <td>{c.name}</td>
            <td>{c.type}</td>
            <td>{c.nullable ? 'YES' : 'NO'}</td>
            <td>{c.defaultValue ?? ''}</td>
            <td>{c.primaryKeyOrdinal !== null ? <Tag>PK{c.primaryKeyOrdinal}</Tag> : ''}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  )
}
