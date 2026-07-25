import { useEffect, useState } from 'react'
import styled from 'styled-components'
import type { BrowseSort } from '../../../shared/types/operation'
import type { OperationGateway } from '../../gateways/ports/OperationGateway'
import type { TableSelection } from '../../entities/schema-tree'
import { Button, EmptyState, ErrorBanner, Notice, Toolbar } from '../../shared/ui'
import { DataGrid } from '../../entities/result-set/ui/DataGrid'
import { useTableData } from './model/useTableData'
import { useTableColumns } from './model/useTableColumns'
import { useTableEditor } from './model/useTableEditor'

const Layout = styled.div`
  display: flex;
  height: 100%;
  min-height: 0;
  background: ${({ theme }) => theme.color.winBg};
  color: ${({ theme }) => theme.color.text};
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
  color: ${({ theme }) => theme.color.textFaint};
  font-size: ${({ theme }) => theme.fontSize.xs};
  white-space: nowrap;
`

interface DataViewProps {
  gateway: OperationGateway
  connectionId: string
  /** 셸의 사이드바 트리가 고른 테이블. 이 뷰는 자기 트리를 갖지 않는다. */
  selection: TableSelection | null
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

export function DataView({ gateway, connectionId, selection }: DataViewProps) {
  const [sortState, setSortState] = useState<SortState>({ key: '', sort: undefined })

  const schema = selection?.schema ?? ''
  const table = selection?.table ?? ''
  const sortKey = `${connectionId}\u0000${schema}\u0000${table}`
  const sort = sortState.key === sortKey ? sortState.sort : undefined

  const data = useTableData(gateway, connectionId, selection, sort)
  const cols = useTableColumns(gateway, connectionId, selection)
  const columnNames = data.columns.map((c) => c.name)
  const editor = useTableEditor(gateway, connectionId, schema, table, columnNames, cols.pkColumns, data.rows)
  const canEdit = cols.pkColumns.length > 0

  // 선택/정렬/연결이 바뀌면 스테이징된 편집을 버린다 — 다른 테이블로 편집이 새어나가면 안 된다.
  useEffect(() => { editor.discard() }, [connectionId, schema, table, sort?.column, sort?.direction])

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
    void editor.save().then((ok) => { if (ok) data.reload() })
  }

  return (
    <Layout>
      <Right>
        {data.error !== null && <ErrorBanner>{data.error}</ErrorBanner>}
        {selection !== null && editor.error !== null && <ErrorBanner>{editor.error}</ErrorBanner>}
        {selection === null ? (
          <EmptyState title="테이블을 선택하세요." hint="왼쪽 트리에서 스키마를 펼쳐 테이블을 고르세요" />
        ) : (
          <>
            {canEdit ? (
              <Toolbar>
                <Spacer />
                <EditHint>셀을 두 번 누르거나 Enter로 편집</EditHint>
                <span>{editor.changeCount} changes</span>
                <Button variant="secondary" size="sm" onClick={editor.addRow}>Add row</Button>
                <Button variant="secondary" size="sm" disabled={!editor.dirty} onClick={editor.discard}>Discard</Button>
                <Button variant="secondary" size="sm" disabled={!editor.dirty} onClick={handleSave}>Save</Button>
              </Toolbar>
            ) : (
              <Notice>PK 없음 — 편집 불가</Notice>
            )}
            {data.loading && data.rows.length === 0 && <Notice>불러오는 중…</Notice>}
            <DataGrid
              columns={data.columns}
              rows={data.rows}
              hasMore={data.hasMore}
              onLoadMore={() => void data.loadMore()}
              {...(sort ? { sort } : {})}
              onHeaderClick={toggleSort}
              {...(canEdit
                ? { editing: { onCommitCell: editor.editCell, edits: editor.edits, deletedRows: editor.deleted, onToggleDelete: editor.toggleDelete, newRows: editor.newRows, onCommitNewCell: editor.editNewCell, onSetNull: editor.setNull, onSetNewCellNull: editor.setNewCellNull } }
                : {})}
            />
          </>
        )}
      </Right>
    </Layout>
  )
}
