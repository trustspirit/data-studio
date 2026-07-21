import styled from 'styled-components'
import type { ForeignKeyInfo } from '../../../../shared/types/schema'

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

export function ForeignKeyList({ foreignKeys }: { foreignKeys: readonly ForeignKeyInfo[] }) {
  if (foreignKeys.length === 0) return <Empty>외래키 없음</Empty>
  return (
    <Table>
      <thead>
        <tr>
          <th>Name</th>
          <th>Columns</th>
          <th>References</th>
        </tr>
      </thead>
      <tbody>
        {foreignKeys.map((f) => (
          <tr key={f.name}>
            <td>{f.name}</td>
            <td>({f.columns.join(', ')})</td>
            <td>
              {f.referencedSchema}.{f.referencedTable}({f.referencedColumns.join(', ')})
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
  )
}
