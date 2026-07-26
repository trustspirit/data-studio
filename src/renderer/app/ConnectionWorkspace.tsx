import { useEffect, useRef, useState } from 'react'
import styled from 'styled-components'
import type { OperationGateway } from '../gateways/ports/OperationGateway'
import type { AiGateway } from '../gateways/ports/AiGateway'
import type { AiAccountStatus } from '../gateways/ports/ConnectionGateway'
import type { TableSelection } from '../entities/schema-tree'
import type { Capability } from '../../shared/types/capability'
import type { EngineId } from '../../shared/types/connection'
import { QueryWorkspace } from '../features/query'
import { StructureView } from '../features/structure'
import { DataView } from '../features/data'
import { ErView } from '../features/er'
import { DocumentsView } from '../features/documents'
import { KeyBrowserView } from '../features/keys'
import { StreamsView } from '../features/streams'
import { DynamoView } from '../features/dynamo'
import { AiChatPanel } from '../features/ai'
// DataView가 요구하는 selection 없음 안내용 — 아래 이름 EmptyState는 이미 이 뷰가 쓰고 있다.
import { EmptyState as TableEmptyState } from '../shared/ui'

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
const Middle = styled.div`
  flex: 1;
  min-height: 0;
  min-width: 0;
  display: flex;
`
const Body = styled.div`
  flex: 1;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
`
const AiPane = styled.div`
  flex: 0 0 340px;
  min-width: 0;
  overflow: hidden;
`
const AiToggle = styled.button<{ $active: boolean }>`
  margin-left: auto;
  font-family: ${({ theme }) => theme.font.ui};
  font-size: ${({ theme }) => theme.fontSize.sm};
  padding: 4px 12px;
  border: none;
  border-radius: ${({ theme }) => theme.radius.md};
  cursor: pointer;
  color: ${({ theme, $active }) => ($active ? theme.color.accent : theme.color.textDim)};
  background: ${({ theme, $active }) => ($active ? theme.color.panel : 'transparent')};
  &:hover {
    color: ${({ theme, $active }) => ($active ? theme.color.accent : theme.color.text)};
  }
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
const AiAccountBadge = styled.span<{ $tone: 'ok' | 'warn' }>`
  color: ${({ theme, $tone }) => ($tone === 'ok' ? theme.color.green : theme.color.orange)};
`
const EmptyState = styled.div`
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: ${({ theme }) => theme.color.textDim};
  font-family: ${({ theme }) => theme.font.ui};
`

type View = 'query' | 'structure' | 'data' | 'er' | 'documents' | 'keys' | 'streams' | 'dynamo'

const VIEW_ORDER: readonly View[] = ['query', 'structure', 'data', 'er', 'documents', 'keys', 'streams', 'dynamo']
const VIEW_CAPABILITY: Record<View, Capability> = {
  query: 'sql',
  structure: 'schema',
  data: 'data',
  er: 'schema',
  documents: 'document',
  keys: 'keyvalue',
  streams: 'stream',
  dynamo: 'dynamo',
}
const VIEW_LABEL: Record<View, string> = {
  query: 'Query',
  structure: 'Structure',
  data: 'Data',
  er: 'ER',
  documents: 'Documents',
  keys: 'Key Browser',
  streams: 'Streams',
  dynamo: 'Items',
}

interface ConnectionWorkspaceProps {
  gateway: OperationGateway
  /** 없으면 AI 어시스턴트 토글이 표시되지 않는다(테스트·부분 조립 허용). */
  ai?: AiGateway | undefined
  connectionId: string
  connectionName: string
  capabilities: readonly Capability[]
  /** 쿼리 에디터의 SQL 방언·자동완성 선택용. */
  engine?: EngineId | undefined
  /** AI 읽기 전용 계정의 연결 결과. 없으면(테스트·부분 조립) 표시하지 않는다. */
  aiAccount?: AiAccountStatus | undefined
  /**
   * 셸의 사이드바 트리가 고른 테이블. 미전달이면 워크스페이스가 자체 선택을
   * 들고 동작한다(테스트·부분 조립) — 그래야 트리 없이도 ER→Structure 점프가 산다.
   */
  selection?: TableSelection | null | undefined
  onSelectionChange?: ((selection: TableSelection | null) => void) | undefined
  /** 테이블 디자이너의 스키마 자동완성 목록. */
  schemas?: readonly string[] | undefined
  /** DDL로 서버 스키마가 바뀌었다 — 셸이 트리를 다시 읽어야 한다. */
  onSchemaChanged?: (() => void) | undefined
}

export function ConnectionWorkspace({
  gateway,
  ai,
  connectionId,
  connectionName,
  capabilities,
  engine,
  aiAccount,
  selection,
  onSelectionChange,
  schemas,
  onSchemaChanged,
}: ConnectionWorkspaceProps) {
  const availableViews = VIEW_ORDER.filter((v) => capabilities.includes(VIEW_CAPABILITY[v]))
  const [view, setView] = useState<View>(() => availableViews[0] ?? 'query')
  const [ownSelection, setOwnSelection] = useState<TableSelection | null>(null)
  const [aiOpen, setAiOpen] = useState(false)

  const controlled = selection !== undefined
  const activeSelection = controlled ? selection : ownSelection
  const selectTable = (sel: TableSelection | null) => {
    if (onSelectionChange !== undefined) onSelectionChange(sel)
    if (!controlled) setOwnSelection(sel)
  }

  const canData = capabilities.includes('data')
  const seen = useRef(activeSelection)
  useEffect(() => {
    const prev = seen.current
    seen.current = activeSelection
    if (activeSelection === null) return
    if (prev?.schema === activeSelection.schema && prev.table === activeSelection.table) return
    if (!canData) return
    // 트리에서 테이블을 눌렀는데 화면이 그대로면 클릭이 먹었는지 알 수 없다.
    // 다만 Structure를 보던 중이면 두 화면 다 그 테이블을 보는 곳이므로 뺏지 않는다.
    setView((cur) => (cur === 'structure' || cur === 'data' ? cur : 'data'))
  }, [activeSelection, canData])

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
        {ai !== undefined && (
          <AiToggle
            type="button"
            data-testid="ai-toggle"
            aria-pressed={aiOpen}
            $active={aiOpen}
            onClick={() => setAiOpen((v) => !v)}
          >
            Assistant
          </AiToggle>
        )}
      </SubTabs>
      <Middle>
        <Body>
          {activeView === null ? (
            <EmptyState>이 엔진에 표시할 뷰가 없습니다.</EmptyState>
          ) : activeView === 'query' ? (
            <QueryWorkspace
              gateway={gateway}
              connectionId={connectionId}
              connectionName={connectionName}
              engine={engine}
            />
          ) : activeView === 'structure' ? (
            <StructureView
              gateway={gateway}
              connectionId={connectionId}
              selection={activeSelection}
              schemas={schemas}
              onSchemaChanged={onSchemaChanged}
              engine={engine}
            />
          ) : activeView === 'data' ? (
            // DataView는 이제 selection이 필수다 — Task 9가 이 파일을 다시 짤 때까지의 임시 가드.
            activeSelection === null ? (
              <TableEmptyState title="테이블을 선택하세요." hint="왼쪽 트리에서 스키마를 펼쳐 테이블을 고르세요" />
            ) : (
              <DataView gateway={gateway} connectionId={connectionId} selection={activeSelection} />
            )
          ) : activeView === 'documents' ? (
            <DocumentsView gateway={gateway} connectionId={connectionId} />
          ) : activeView === 'keys' ? (
            <KeyBrowserView gateway={gateway} connectionId={connectionId} />
          ) : activeView === 'streams' ? (
            <StreamsView gateway={gateway} connectionId={connectionId} />
          ) : activeView === 'dynamo' ? (
            <DynamoView gateway={gateway} connectionId={connectionId} />
          ) : (
            <ErView
              gateway={gateway}
              connectionId={connectionId}
              // ErView는 이제 schema가 필수다 — 워크스페이스엔 목록만 있어 첫 항목으로 임시 대응한다(Task 9가 이 파일을 다시 짤 때까지).
              schema={schemas?.[0] ?? ''}
              onOpenTable={(schema, table) => {
                selectTable({ schema, table })
                setView('structure')
              }}
            />
          )}
        </Body>
        {ai !== undefined && aiOpen && (
          <AiPane>
            <AiChatPanel ai={ai} operation={gateway} connectionId={connectionId} />
          </AiPane>
        )}
      </Middle>
      <StatusBar>
        <StatusDot aria-hidden />
        <span>{connectionName}</span>
        {activeView !== null && <span>{VIEW_LABEL[activeView]}</span>}
        {aiAccount === 'ready' && (
          <AiAccountBadge $tone="ok" data-testid="ai-account-status">
            AI: 전용 읽기 계정
          </AiAccountBadge>
        )}
        {aiAccount === 'failed' && (
          <AiAccountBadge $tone="warn" data-testid="ai-account-status">
            AI 계정 연결 실패 — 사용자 계정 공유
          </AiAccountBadge>
        )}
        <StatusRight>{capabilities.join(' · ')}</StatusRight>
      </StatusBar>
    </Layout>
  )
}
