import { useEffect, useState } from 'react'
import styled from 'styled-components'
import type { OperationGateway } from '../../gateways/ports/OperationGateway'
import { SchemaNavigator, useSchemaTree, type TableSelection } from '../../entities/schema-tree'
import { useTableStructure } from './model/useTableStructure'
import { StructurePanel } from './ui/StructurePanel'

const Layout = styled.div`
  display: flex;
  height: 100%;
  background: ${({ theme }) => theme.color.winBg};
  color: ${({ theme }) => theme.color.text};
`
const Banner = styled.div`
  padding: 8px 12px;
  color: ${({ theme }) => theme.color.red};
  font: ${({ theme }) => theme.font.ui};
  font-size: 13px;
`

interface StructureViewProps {
  gateway: OperationGateway
  connectionId: string
}

export function StructureView({ gateway, connectionId }: StructureViewProps) {
  const tree = useSchemaTree(gateway, connectionId)
  const [selected, setSelected] = useState<TableSelection | null>(null)
  useEffect(() => {
    // 연결이 바뀌면 선택을 초기화한다 (useSchemaTree의 캐시 리셋과 일관).
    setSelected(null)
  }, [connectionId])
  const structure = useTableStructure(gateway, connectionId, selected)

  return (
    <Layout>
      <SchemaNavigator
        schemas={tree.schemas}
        tablesBySchema={tree.tablesBySchema}
        expanded={tree.expanded}
        selected={selected}
        onToggle={tree.toggle}
        onSelect={setSelected}
      />
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
        {tree.error !== null && <Banner>{tree.error}</Banner>}
        <StructurePanel
          hasSelection={selected !== null}
          loading={structure.loading}
          error={structure.error}
          columns={structure.columns}
          indexes={structure.indexes}
          foreignKeys={structure.foreignKeys}
        />
      </div>
    </Layout>
  )
}
