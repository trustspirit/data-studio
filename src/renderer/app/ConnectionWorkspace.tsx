import { useState } from 'react'
import styled from 'styled-components'
import type { OperationGateway } from '../gateways/ports/OperationGateway'
import type { TableSelection } from '../entities/schema-tree'
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

type View = 'query' | 'structure' | 'data' | 'er'

interface ConnectionWorkspaceProps {
  gateway: OperationGateway
  connectionId: string
  connectionName: string
}

export function ConnectionWorkspace({ gateway, connectionId, connectionName }: ConnectionWorkspaceProps) {
  const [view, setView] = useState<View>('query')
  const [erJump, setErJump] = useState<TableSelection | null>(null)
  return (
    <Layout>
      <SubTabs>
        <SubTab
          type="button"
          data-testid="subtab-query"
          $active={view === 'query'}
          onClick={() => setView('query')}
        >
          Query
        </SubTab>
        <SubTab
          type="button"
          data-testid="subtab-structure"
          $active={view === 'structure'}
          onClick={() => setView('structure')}
        >
          Structure
        </SubTab>
        <SubTab type="button" data-testid="subtab-data" $active={view === 'data'} onClick={() => setView('data')}>
          Data
        </SubTab>
        <SubTab type="button" data-testid="subtab-er" $active={view === 'er'} onClick={() => setView('er')}>
          ER
        </SubTab>
      </SubTabs>
      <Body>
        {view === 'query' ? (
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
