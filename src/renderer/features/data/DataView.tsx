import { useEffect, useState } from 'react'
import styled from 'styled-components'
import type { BrowseSort } from '../../../shared/types/operation'
import type { OperationGateway } from '../../gateways/ports/OperationGateway'
import { SchemaNavigator, useSchemaTree, type TableSelection } from '../../entities/schema-tree'
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

interface DataViewProps {
  gateway: OperationGateway
  connectionId: string
}

export function DataView({ gateway, connectionId }: DataViewProps) {
  const tree = useSchemaTree(gateway, connectionId)
  const [selected, setSelected] = useState<TableSelection | null>(null)
  const [sort, setSort] = useState<BrowseSort | undefined>(undefined)
  const data = useTableData(gateway, connectionId, selected, sort)

  const schema = selected?.schema ?? ''
  const table = selected?.table ?? ''
  const cols = useTableColumns(gateway, connectionId, selected)
  const columnNames = data.columns.map((c) => c.name)
  const editor = useTableEditor(gateway, connectionId, schema, table, columnNames, cols.pkColumns, data.rows)
  const canEdit = cols.pkColumns.length > 0

  // 연결이 바뀌면 선택·정렬 초기화(useSchemaTree의 캐시 리셋과 일관).
  useEffect(() => { setSelected(null); setSort(undefined) }, [connectionId])

  // 선택/정렬/연결이 바뀌면 스테이징된 편집을 버린다 — 다른 테이블로 편집이 새어나가면 안 된다.
  useEffect(() => { editor.discard() }, [connectionId, schema, table, sort?.column, sort?.direction])

  const select = (s: TableSelection) => { setSelected(s); setSort(undefined) }
  const toggleSort = (column: string) => {
    setSort((prev) =>
      prev?.column === column
        ? { column, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
        : { column, direction: 'asc' },
    )
  }

  const handleSave = () => {
    void editor.save().then((ok) => { if (ok) data.reload() })
  }

  return (
    <Layout>
      <SchemaNavigator
        schemas={tree.schemas}
        tablesBySchema={tree.tablesBySchema}
        expanded={tree.expanded}
        selected={selected}
        onToggle={tree.toggle}
        onSelect={select}
      />
      <Right>
        {tree.error !== null && <ErrorBanner>{tree.error}</ErrorBanner>}
        {data.error !== null && <ErrorBanner>{data.error}</ErrorBanner>}
        {selected !== null && editor.error !== null && <ErrorBanner>{editor.error}</ErrorBanner>}
        {selected === null ? (
          <EmptyState title="테이블을 선택하세요." hint="왼쪽 트리에서 스키마를 펼쳐 테이블을 고르세요" />
        ) : (
          <>
            {canEdit ? (
              <Toolbar>
                <Spacer />
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
                ? { editing: { onCommitCell: editor.editCell, edits: editor.edits, deletedRows: editor.deleted, onToggleDelete: editor.deleteRow, newRows: editor.newRows, onCommitNewCell: editor.editNewCell, onSetNull: editor.setNull, onSetNewCellNull: editor.setNewCellNull } }
                : {})}
            />
          </>
        )}
      </Right>
    </Layout>
  )
}
