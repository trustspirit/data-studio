import styled from 'styled-components'
import type { ForeignKeyInfo } from '../../../../shared/types/schema'
import { DataTable as Table } from '../../../shared/ui'

const Empty = styled.div`
  padding: 6px 10px;
  color: ${({ theme }) => theme.color.text.faint};
  font-size: ${({ theme }) => theme.fontSize.body};
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
