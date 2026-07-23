import { useEffect, useState } from 'react'
import styled from 'styled-components'
import type { OperationGateway } from '../gateways/ports/OperationGateway'
import type { TableSelection } from '../entities/schema-tree'
import type { Capability } from '../../shared/types/capability'
import { QueryWorkspace } from '../features/query'
import { StructureView } from '../features/structure'
import { DataView } from '../features/data'
import { ErView } from '../features/er'

const Layout = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
`
const SubTabs = styled.div`
  display: flex;
  gap: 4px;
  padding: 6px 8px;
  border-bottom: 1px solid ${({ theme }) => theme.color.border};
  background: ${({ theme }) => theme.color.toolbar};
`
const SubTab = styled.button<{ $active: boolean }>`
  font: ${({ theme }) => theme.font.ui};
  font-size: 12px;
  padding: 4px 12px;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  color: ${({ theme, $active }) => ($active ? theme.color.text : theme.color.textDim)};
  background: ${({ theme, $active }) => ($active ? theme.color.panel : 'transparent')};
`
const Body = styled.div`
  flex: 1;
  min-height: 0;
`
const EmptyState = styled.div`
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: ${({ theme }) => theme.color.textDim};
  font: ${({ theme }) => theme.font.ui};
`

type View = 'query' | 'structure' | 'data' | 'er'

const VIEW_ORDER: readonly View[] = ['query', 'structure', 'data', 'er']
const VIEW_CAPABILITY: Record<View, Capability> = {
  query: 'sql',
  structure: 'schema',
  data: 'data',
  er: 'schema',
}
const VIEW_LABEL: Record<View, string> = {
  query: 'Query',
  structure: 'Structure',
  data: 'Data',
  er: 'ER',
}

interface ConnectionWorkspaceProps {
  gateway: OperationGateway
  connectionId: string
  connectionName: string
  capabilities: readonly Capability[]
}

export function ConnectionWorkspace({
  gateway,
  connectionId,
  connectionName,
  capabilities,
}: ConnectionWorkspaceProps) {
  const availableViews = VIEW_ORDER.filter((v) => capabilities.includes(VIEW_CAPABILITY[v]))
  const [view, setView] = useState<View>(() => availableViews[0] ?? 'query')
  const [erJump, setErJump] = useState<TableSelection | null>(null)

  useEffect(() => {
    if (availableViews.length > 0 && !availableViews.includes(view)) {
      const fallback = availableViews[0]
      if (fallback !== undefined) setView(fallback)
    }
  }, [capabilities, view])

  return (
    <Layout>
      <SubTabs>
        {availableViews.map((v) => (
          <SubTab
            key={v}
            type="button"
            data-testid={`subtab-${v}`}
            $active={view === v}
            onClick={() => setView(v)}
          >
            {VIEW_LABEL[v]}
          </SubTab>
        ))}
      </SubTabs>
      <Body>
        {availableViews.length === 0 ? (
          <EmptyState>이 엔진에 표시할 뷰가 없습니다.</EmptyState>
        ) : view === 'query' ? (
          <QueryWorkspace gateway={gateway} connectionId={connectionId} connectionName={connectionName} />
        ) : view === 'structure' ? (
          <StructureView gateway={gateway} connectionId={connectionId} externalSelection={erJump} />
        ) : view === 'data' ? (
          <DataView gateway={gateway} connectionId={connectionId} />
        ) : (
          <ErView
            gateway={gateway}
            connectionId={connectionId}
            onOpenTable={(schema, table) => {
              setErJump({ schema, table })
              setView('structure')
            }}
          />
        )}
      </Body>
    </Layout>
  )
}
