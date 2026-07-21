import { useEffect, useState } from 'react'
import styled from 'styled-components'
import type { BrowseSort } from '../../../shared/types/operation'
import type { OperationGateway } from '../../gateways/ports/OperationGateway'
import { SchemaNavigator, useSchemaTree, type TableSelection } from '../../entities/schema-tree'
import { DataGrid } from '../../entities/result-set/ui/DataGrid'
import { useTableData } from './model/useTableData'

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

interface DataViewProps {
  gateway: OperationGateway
  connectionId: string
}

export function DataView({ gateway, connectionId }: DataViewProps) {
  const tree = useSchemaTree(gateway, connectionId)
  const [selected, setSelected] = useState<TableSelection | null>(null)
  const [sort, setSort] = useState<BrowseSort | undefined>(undefined)
  const data = useTableData(gateway, connectionId, selected, sort)

  // 연결이 바뀌면 선택·정렬 초기화(useSchemaTree의 캐시 리셋과 일관).
  useEffect(() => { setSelected(null); setSort(undefined) }, [connectionId])

  const select = (s: TableSelection) => { setSelected(s); setSort(undefined) }
  const toggleSort = (column: string) => {
    setSort((prev) =>
      prev?.column === column
        ? { column, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
        : { column, direction: 'asc' },
    )
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
        {selected === null ? (
          <Notice>테이블을 선택하세요.</Notice>
        ) : (
          <DataGrid
            columns={data.columns}
            rows={data.rows}
            hasMore={data.hasMore}
            onLoadMore={() => void data.loadMore()}
            {...(sort ? { sort } : {})}
            onHeaderClick={toggleSort}
          />
        )}
      </Right>
    </Layout>
  )
}
