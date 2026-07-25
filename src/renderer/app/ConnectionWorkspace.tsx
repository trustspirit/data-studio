import { useState } from 'react'
import styled from 'styled-components'
import type { OperationGateway } from '../gateways/ports/OperationGateway'
import type { TableSelection } from '../entities/schema-tree'
import type { Capability } from '../../shared/types/capability'
import { QueryWorkspace } from '../features/query'
import { StructureView } from '../features/structure'
import { DataView } from '../features/data'
import { ErView } from '../features/er'
import { DocumentsView } from '../features/documents'
import { KeyBrowserView } from '../features/keys'
import { StreamsView } from '../features/streams'

const Layout = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
`
const SubTabs = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.space.xs};
  padding: ${({ theme }) => `${theme.space.xs} ${theme.space.sm}`};
  border-bottom: 1px solid ${({ theme }) => theme.color.border};
  background: ${({ theme }) => theme.color.toolbar};
`
const SubTab = styled.button<{ $active: boolean }>`
  font-family: ${({ theme }) => theme.font.ui};
  font-size: ${({ theme }) => theme.fontSize.sm};
  padding: 4px 12px;
  border: none;
  border-radius: ${({ theme }) => theme.radius.md};
  cursor: pointer;
  color: ${({ theme, $active }) => ($active ? theme.color.text : theme.color.textDim)};
  background: ${({ theme, $active }) => ($active ? theme.color.panel : 'transparent')};
  &:hover {
    color: ${({ theme }) => theme.color.text};
  }
`
const Body = styled.div`
  flex: 1;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
`
const StatusBar = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.space.md};
  padding: 0 ${({ theme }) => theme.space.md};
  height: 24px;
  border-top: 1px solid ${({ theme }) => theme.color.border};
  background: ${({ theme }) => theme.color.titlebar};
  color: ${({ theme }) => theme.color.textDim};
  font-family: ${({ theme }) => theme.font.ui};
  font-size: ${({ theme }) => theme.fontSize.xs};
`
const StatusDot = styled.span`
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: ${({ theme }) => theme.color.green};
`
const StatusRight = styled.span`
  margin-left: auto;
  color: ${({ theme }) => theme.color.textFaint};
`
const EmptyState = styled.div`
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: ${({ theme }) => theme.color.textDim};
  font-family: ${({ theme }) => theme.font.ui};
`

type View = 'query' | 'structure' | 'data' | 'er' | 'documents' | 'keys' | 'streams'

const VIEW_ORDER: readonly View[] = ['query', 'structure', 'data', 'er', 'documents', 'keys', 'streams']
const VIEW_CAPABILITY: Record<View, Capability> = {
  query: 'sql',
  structure: 'schema',
  data: 'data',
  er: 'schema',
  documents: 'document',
  keys: 'keyvalue',
  streams: 'stream',
}
const VIEW_LABEL: Record<View, string> = {
  query: 'Query',
  structure: 'Structure',
  data: 'Data',
  er: 'ER',
  documents: 'Documents',
  keys: 'Key Browser',
  streams: 'Streams',
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

  const activeView = availableViews.includes(view) ? view : (availableViews[0] ?? null)

  return (
    <Layout>
      <SubTabs>
        {availableViews.map((v) => (
          <SubTab
            key={v}
            type="button"
            data-testid={`subtab-${v}`}
            $active={activeView === v}
            onClick={() => setView(v)}
          >
            {VIEW_LABEL[v]}
          </SubTab>
        ))}
      </SubTabs>
      <Body>
        {activeView === null ? (
          <EmptyState>이 엔진에 표시할 뷰가 없습니다.</EmptyState>
        ) : activeView === 'query' ? (
          <QueryWorkspace gateway={gateway} connectionId={connectionId} connectionName={connectionName} />
        ) : activeView === 'structure' ? (
          <StructureView gateway={gateway} connectionId={connectionId} externalSelection={erJump} />
        ) : activeView === 'data' ? (
          <DataView gateway={gateway} connectionId={connectionId} />
        ) : activeView === 'documents' ? (
          <DocumentsView gateway={gateway} connectionId={connectionId} />
        ) : activeView === 'keys' ? (
          <KeyBrowserView gateway={gateway} connectionId={connectionId} />
        ) : activeView === 'streams' ? (
          <StreamsView gateway={gateway} connectionId={connectionId} />
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
      <StatusBar>
        <StatusDot aria-hidden />
        <span>{connectionName}</span>
        {activeView !== null && <span>{VIEW_LABEL[activeView]}</span>}
        <StatusRight>{capabilities.join(' · ')}</StatusRight>
      </StatusBar>
    </Layout>
  )
}
