import { useEffect, useState } from 'react'
import styled from 'styled-components'
import type { BrowseFilter, BrowseSort } from '../../../shared/types/operation'
import { TableFilter } from './ui/TableFilter'
import { ChangeReview } from './ui/ChangeReview'
import type { OperationGateway } from '../../gateways/ports/OperationGateway'
import type { TableSelection } from '../../entities/schema-tree'
import { Badge, Button, ConfirmDialog, EmptyState, ErrorBanner, Icon, Toolbar } from '../../shared/ui'
import { DataGrid } from '../../entities/result-set/ui/DataGrid'
import { downloadResultCsv } from '../../entities/result-set/renderers/resultCsv'
import { useTableData } from './model/useTableData'
import { useTableColumns } from './model/useTableColumns'
import { useTableEditor } from './model/useTableEditor'

const Layout = styled.div`
  display: flex;
  height: 100%;
  min-height: 0;
  background: ${({ theme }) => theme.color.surface.bg};
  color: ${({ theme }) => theme.color.text.primary};
`
const Right = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
`
const Spacer = styled.span`
  flex: 1;
`
const EditHint = styled.span`
  color: ${({ theme }) => theme.color.text.faint};
  font-size: ${({ theme }) => theme.fontSize.label};
  white-space: nowrap;
  @media (max-width: 1100px) { display: none; }
`
const Footer = styled.footer`
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: ${({ theme }) => theme.space.md};
  min-height: 38px;
  padding: ${({ theme }) => `${theme.space.xs} ${theme.space.md}`};
  border-top: 1px solid ${({ theme }) => theme.color.border.strong};
  background: ${({ theme }) => theme.color.surface.base};
  color: ${({ theme }) => theme.color.text.dim};
  font-size: ${({ theme }) => theme.fontSize.label};
  font-variant-numeric: tabular-nums;
`

interface DataViewProps {
  gateway: OperationGateway
  connectionId: string
  /** 문서 자체가 대상 테이블을 확정한다 — 이 뷰는 자기 트리를 갖지 않는다. */
  selection: TableSelection
  /** 스테이징된 편집 유무가 바뀔 때마다 알린다 — 탭 닫기 확인에 쓴다. */
  onDirtyChange?: ((dirty: boolean) => void) | undefined
}

/**
 * 정렬은 테이블에 딸린 상태다. 다른 테이블로 옮기면 버려야 하는데, effect로
 * 되돌리면 한 렌더 동안 옛 정렬로 조회가 한 번 나간다 — 그래서 상태에 대상
 * 테이블을 함께 담고 어긋나면 정렬이 없는 것으로 읽는다.
 */
interface SortState {
  readonly key: string
  readonly sort: BrowseSort | undefined
}

export function DataView({ gateway, connectionId, selection, onDirtyChange }: DataViewProps) {
  const [sortState, setSortState] = useState<SortState>({ key: '', sort: undefined })
  const [pendingAction, setPendingAction] = useState<{ kind: 'reload' } | { kind: 'sort'; column: string } | { kind: 'filter'; filters: readonly BrowseFilter[] } | null>(null)
  const [filterState, setFilterState] = useState<{ key: string; filters: readonly BrowseFilter[] }>({ key: '', filters: [] })
  const [reviewing, setReviewing] = useState(false)

  const schema = selection.schema
  const table = selection.table
  const sortKey = `${connectionId}\u0000${schema}\u0000${table}`
  const sort = sortState.key === sortKey ? sortState.sort : undefined
  const filters = filterState.key === sortKey ? filterState.filters : []
  const setFilters = (next: readonly BrowseFilter[]) => setFilterState({ key: sortKey, filters: next })

  const data = useTableData(gateway, connectionId, selection, sort, filters)
  const cols = useTableColumns(gateway, connectionId, selection)
  const columnNames = data.columns.map((c) => c.name)
  const editor = useTableEditor(gateway, connectionId, schema, table, columnNames, cols.pkColumns, data.rows)
  const canEdit = cols.pkColumns.length > 0

  // 선택/정렬/연결이 바뀌면 스테이징된 편집을 버린다 — 다른 테이블로 편집이 새어나가면 안 된다.
  useEffect(() => { editor.discard() }, [connectionId, schema, table, sort?.column, sort?.direction])

  // dirty 여부를 상위(문서 탭)로 올린다 — 탭을 닫을 때 이 편집이 사라진다고 경고하는 데 쓴다.
  useEffect(() => {
    onDirtyChange?.(editor.dirty)
  }, [editor.dirty, onDirtyChange])

  const toggleSort = (column: string) => {
    setSortState((prev) => {
      const current = prev.key === sortKey ? prev.sort : undefined
      return {
        key: sortKey,
        sort:
          current?.column === column
            ? { column, direction: current.direction === 'asc' ? 'desc' : 'asc' }
            : { column, direction: 'asc' },
      }
    })
  }

  const handleSave = () => {
    void editor.save().then((ok) => { if (ok) { setReviewing(false); data.reload() } })
  }
  const requestReload = () => {
    if (editor.dirty) setPendingAction({ kind: 'reload' })
    else data.reload()
  }
  const requestSort = (column: string) => {
    if (editor.dirty) setPendingAction({ kind: 'sort', column })
    else toggleSort(column)
  }
  const requestFilter = (next: readonly BrowseFilter[]) => {
    if (editor.dirty) setPendingAction({ kind: 'filter', filters: next })
    else setFilters(next)
  }

  return (
    <Layout>
      <Right>
        {data.error !== null && <ErrorBanner>{data.error}</ErrorBanner>}
        {editor.error !== null && <ErrorBanner>{editor.error}</ErrorBanner>}
        <>
            <Toolbar>
              <Badge tone={canEdit ? 'accent' : 'neutral'}>{canEdit ? '편집 가능' : '읽기 전용'}</Badge>
              <Button variant="ghost" size="sm" disabled={data.loading || editor.saving} onClick={requestReload} title="테이블 다시 불러오기">
                <Icon name="refresh" size="sm" /> 새로고침
              </Button>
              <Button variant="ghost" size="sm" disabled={data.columns.length === 0 || editor.dirty || data.loading} title="불러온 원본 행을 CSV로 저장" onClick={() => downloadResultCsv(data.columns, data.rows)}>CSV 내보내기</Button>
              <Spacer />
              {canEdit && <>
                <EditHint>셀을 두 번 누르거나 Enter로 편집</EditHint>
                {editor.dirty && <Badge tone="warning">{editor.changeCount} changes</Badge>}
                <Button variant="ghost" size="sm" disabled={editor.saving || data.loading} onClick={editor.addRow}>Add row</Button>
                <Button variant="ghost" size="sm" disabled={!editor.dirty || editor.saving} onClick={editor.discard}>Discard</Button>
                <Button size="sm" disabled={!editor.dirty || editor.saving} onClick={() => setReviewing(true)}>{editor.saving ? 'Saving…' : 'Save'}</Button>
              </>}
            </Toolbar>
          <TableFilter columns={columnNames} active={filters} disabled={data.loading || editor.saving} onApply={requestFilter} />
          {!canEdit && <EditHint style={{ padding: '8px 12px' }}>PK 없음 — 편집 불가</EditHint>}
          {data.loading && data.rows.length === 0 && <EmptyState title="테이블을 불러오고 있습니다…" />}
          {!data.loading && data.rows.length === 0 && editor.newRows.length === 0 && data.error === null && <EmptyState title="아직 데이터가 없습니다" hint={canEdit ? 'Add row로 첫 번째 행을 추가하세요.' : '이 테이블은 비어 있습니다.'} />}
          <DataGrid
            columns={data.columns.map((column) => ({ ...column, type: cols.columns.find((info) => info.name === column.name)?.type ?? column.type }))}
            rows={data.rows}
            hasMore={data.hasMore}
            onLoadMore={() => void data.loadMore()}
            {...(sort ? { sort } : {})}
            onHeaderClick={editor.saving ? undefined : requestSort}
            {...(canEdit
              ? { editing: { onCommitCell: editor.editCell, edits: editor.edits, deletedRows: editor.deleted, onToggleDelete: editor.toggleDelete, newRows: editor.newRows, onCommitNewCell: editor.editNewCell, onSetNull: editor.setNull, onSetNewCellNull: editor.setNewCellNull } }
              : {})}
          />
          <Footer>
            <span role="status">{data.loading ? '불러오는 중…' : `${data.rows.length.toLocaleString()}행 불러옴`}</span>
            <span>{data.columns.length}개 컬럼</span>
            {sort && <span>{sort.column} · {sort.direction === 'asc' ? '오름차순' : '내림차순'}</span>}
            <Spacer />
            {data.hasMore && <Button variant="ghost" size="sm" disabled={data.loading || editor.saving} onClick={() => void data.loadMore()}>다음 결과 불러오기</Button>}
          </Footer>
          {reviewing && <ChangeReview edits={editor.edits} deleted={editor.deleted} newRows={editor.newRows} rows={data.rows} columns={columnNames} saving={editor.saving} error={editor.error} onSave={handleSave} onClose={() => { if (!editor.saving) setReviewing(false) }} />}
          {pendingAction !== null && <ConfirmDialog title="적용하지 않은 편집이 있습니다" message="조회 조건을 바꾸거나 새로고침하면 스테이징된 변경이 사라집니다." confirmLabel="변경 버리고 계속" onCancel={() => setPendingAction(null)} onConfirm={() => {
            editor.discard()
            if (pendingAction.kind === 'reload') data.reload()
            else if (pendingAction.kind === 'sort') toggleSort(pendingAction.column)
            else setFilters(pendingAction.filters)
            setPendingAction(null)
          }} />}
        </>
      </Right>
    </Layout>
  )
}
