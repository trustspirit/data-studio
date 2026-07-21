import { useEffect, useState } from 'react'
import styled from 'styled-components'
import type { BrowseSort } from '../../../shared/types/operation'
import type { OperationGateway } from '../../gateways/ports/OperationGateway'
import { SchemaNavigator, useSchemaTree, type TableSelection } from '../../entities/schema-tree'
import { DataGrid } from '../../entities/result-set/ui/DataGrid'
import { useTableData } from './model/useTableData'
import { useTableColumns } from './model/useTableColumns'
import { useTableEditor } from './model/useTableEditor'

const Layout = styled.div`
  display: flex;
  height: 100%;
  background: ${({ theme }) => theme.color.winBg};
  color: ${({ theme }) => theme.color.text};
`
const Right = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
`
const Notice = styled.div`
  padding: 16px;
  color: ${({ theme }) => theme.color.textFaint};
  font: ${({ theme }) => theme.font.ui};
  font-size: 13px;
`
const Banner = styled.div`
  padding: 8px 12px;
  color: ${({ theme }) => theme.color.red};
  font: ${({ theme }) => theme.font.ui};
  font-size: 13px;
`
const Toolbar = styled.div`
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 6px 12px;
  border-bottom: 1px solid ${({ theme }) => theme.color.border};
  background: ${({ theme }) => theme.color.toolbar};
  color: ${({ theme }) => theme.color.textDim};
  font: ${({ theme }) => theme.font.ui};
  font-size: 12px;
`
const ToolbarButton = styled.button`
  font: inherit;
  padding: 4px 10px;
  border-radius: 4px;
  border: 1px solid ${({ theme }) => theme.color.border};
  background: ${({ theme }) => theme.color.panel};
  color: ${({ theme }) => theme.color.text};
  cursor: pointer;

  &:disabled {
    opacity: 0.4;
    cursor: default;
  }
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
        {tree.error !== null && <Banner>{tree.error}</Banner>}
        {data.error !== null && <Banner>{data.error}</Banner>}
        {selected !== null && editor.error !== null && <Banner>{editor.error}</Banner>}
        {selected === null ? (
          <Notice>테이블을 선택하세요.</Notice>
        ) : (
          <>
            {canEdit ? (
              <Toolbar>
                <span>{editor.changeCount} changes</span>
                <ToolbarButton disabled={!editor.dirty} onClick={editor.discard}>Discard</ToolbarButton>
                <ToolbarButton disabled={!editor.dirty} onClick={handleSave}>Save</ToolbarButton>
              </Toolbar>
            ) : (
              <Notice>PK 없음 — 편집 불가</Notice>
            )}
            <DataGrid
              columns={data.columns}
              rows={data.rows}
              hasMore={data.hasMore}
              onLoadMore={() => void data.loadMore()}
              {...(sort ? { sort } : {})}
              onHeaderClick={toggleSort}
              {...(canEdit
                ? { editing: { onCommitCell: editor.editCell, deletedRows: editor.deleted, onToggleDelete: editor.deleteRow } }
                : {})}
            />
          </>
        )}
      </Right>
    </Layout>
  )
}
