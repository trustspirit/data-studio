import styled from 'styled-components'
import type { ColumnDescriptor } from '../../../../shared/types/resultSet'
import type { WireValue } from '../../../../shared/types/wire'
import { Button, EmptyState, ErrorBanner, Notice } from '../../../shared/ui'
import { DataGrid } from '../../../entities/result-set/ui/DataGrid'

const Wrap = styled.div`
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border-top: 1px solid ${({ theme }) => theme.color.border.soft};
`

interface Props {
  columns: readonly ColumnDescriptor[]
  rows: readonly (readonly WireValue[])[]
  rowsAffected: number | null
  notices: readonly string[]
  error: string | null
  hasMore: boolean
  onLoadMore: () => void
  running?: boolean
  completed?: boolean
  truncated?: boolean
}

export function ResultArea({ columns, rows, rowsAffected, notices, error, hasMore, onLoadMore, running = false, completed = false, truncated = false }: Props) {
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
      {columns.length > 0 && rows.length > 0 && (
        <DataGrid columns={columns} rows={rows} hasMore={hasMore} onLoadMore={onLoadMore} />
      )}
      {error === null && columns.length > 0 && rows.length === 0 && !running && (
        <EmptyState title="조회 결과가 없습니다" hint="조건을 변경한 뒤 다시 실행하세요." />
      )}
      {idle && <EmptyState title={running ? '쿼리를 실행하고 있습니다…' : completed ? '실행이 완료되었습니다' : '쿼리를 실행하면 결과가 여기에 표시됩니다'} hint={running ? '오래 걸리는 쿼리는 Cancel로 취소할 수 있습니다.' : '⌘⏎ 또는 Run 버튼으로 실행'} />}
      {truncated && !hasMore && <Notice>결과 크기 제한에 도달했습니다. 조회 범위를 줄여 다시 실행하세요.</Notice>}
      {hasMore && <Button variant="ghost" size="sm" disabled={running} onClick={onLoadMore}>
        {running ? '불러오는 중…' : '다음 결과 불러오기'}
      </Button>}
    </Wrap>
  )
}
