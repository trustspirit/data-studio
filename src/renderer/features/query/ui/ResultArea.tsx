import styled from 'styled-components'
import type { ColumnDescriptor } from '../../../../shared/types/resultSet'
import type { WireValue } from '../../../../shared/types/wire'
import { DataGrid } from '../../../entities/result-set/ui/DataGrid'

const Wrap = styled.div`
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
`
const Banner = styled.div`
  margin: 8px;
  padding: 8px 12px;
  border-radius: 6px;
  background: ${({ theme }) => theme.color.red};
  color: ${({ theme }) => theme.color.onDanger};
  font: ${({ theme }) => theme.font.ui};
  font-size: 13px;
`
const Info = styled.div`
  padding: 12px;
  color: ${({ theme }) => theme.color.textDim};
  font: ${({ theme }) => theme.font.ui};
`

interface Props {
  columns: readonly ColumnDescriptor[]
  rows: readonly (readonly WireValue[])[]
  rowsAffected: number | null
  notices: readonly string[]
  error: string | null
  hasMore: boolean
  onLoadMore: () => void
}

export function ResultArea({ columns, rows, rowsAffected, notices, error, hasMore, onLoadMore }: Props) {
  return (
    <Wrap>
      {error !== null && <Banner>{error}</Banner>}
      {notices.map((n, i) => (
        <Info key={i}>{n}</Info>
      ))}
      {error === null && columns.length === 0 && rowsAffected !== null && (
        <Info>{rowsAffected} rows affected</Info>
      )}
      {error === null && columns.length > 0 && (
        <DataGrid columns={columns} rows={rows} hasMore={hasMore} onLoadMore={onLoadMore} />
      )}
    </Wrap>
  )
}
