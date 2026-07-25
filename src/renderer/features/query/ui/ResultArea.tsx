import styled from 'styled-components'
import type { ColumnDescriptor } from '../../../../shared/types/resultSet'
import type { WireValue } from '../../../../shared/types/wire'
import { EmptyState, ErrorBanner, Notice } from '../../../shared/ui'
import { DataGrid } from '../../../entities/result-set/ui/DataGrid'

const Wrap = styled.div`
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border-top: 1px solid ${({ theme }) => theme.color.borderSoft};
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
  const idle = error === null && columns.length === 0 && rowsAffected === null && notices.length === 0
  return (
    <Wrap>
      {error !== null && <ErrorBanner>{error}</ErrorBanner>}
      {notices.map((n, i) => (
        <Notice key={i}>{n}</Notice>
      ))}
      {error === null && columns.length === 0 && rowsAffected !== null && (
        <Notice>{rowsAffected} rows affected</Notice>
      )}
      {error === null && columns.length > 0 && (
        <DataGrid columns={columns} rows={rows} hasMore={hasMore} onLoadMore={onLoadMore} />
      )}
      {idle && <EmptyState title="쿼리를 실행하면 결과가 여기에 표시됩니다" hint="⌘⏎ 또는 Run 버튼으로 실행" />}
    </Wrap>
  )
}
