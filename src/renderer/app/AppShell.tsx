import { useEffect, useState } from 'react'
import styled from 'styled-components'
import { useGateways } from './GatewayProvider'
import { useConnections } from '../features/connections/model/useConnections'
import { ConnectionsScreen } from '../features/connections'
import { AuditView } from '../features/audit'
import { ConnectionRow, ConnectionTree, type ConnectionRowState } from '../entities/connection-tree'
import { WorkspaceHost } from './WorkspaceHost'
import { useOpenConnections } from './model/useOpenConnections'
import { EmptyState } from '../shared/ui'

const Layout = styled.div<{ $sidebar: boolean }>`
  display: grid;
  grid-template-columns: ${({ theme, $sidebar }) =>
    $sidebar ? `${theme.size.rail} ${theme.size.sidebar} 1fr` : `${theme.size.rail} 1fr`};
  height: 100%;
  min-height: 0;
  background: ${({ theme }) => theme.color.winBg};
  color: ${({ theme }) => theme.color.text};
`
const Rail = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: ${({ theme }) => theme.space.xs};
  padding: ${({ theme }) => theme.space.sm} 0;
  background: ${({ theme }) => theme.color.toolbar};
  border-right: 1px solid ${({ theme }) => theme.color.border};
  overflow: hidden;
`
const RailButton = styled.button<{ $active: boolean }>`
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  padding: 0;
  border: none;
  border-radius: ${({ theme }) => theme.radius.md};
  cursor: pointer;
  color: ${({ theme, $active }) => ($active ? theme.color.text : theme.color.textDim)};
  background: ${({ theme, $active }) => ($active ? theme.color.panel : 'transparent')};
  &:hover {
    color: ${({ theme }) => theme.color.text};
  }
  /* 활성 탭 표시 — 레일 왼쪽 가장자리의 액센트 바 */
  &::before {
    content: '';
    position: absolute;
    left: -8px;
    top: 8px;
    bottom: 8px;
    width: 2px;
    border-radius: 1px;
    background: ${({ theme, $active }) => ($active ? theme.color.accent : 'transparent')};
  }
`

function ConnectionsIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
      <ellipse cx="10" cy="4.8" rx="6.2" ry="2.6" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M3.8 4.8v10.4c0 1.44 2.78 2.6 6.2 2.6s6.2-1.16 6.2-2.6V4.8"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path d="M3.8 10c0 1.44 2.78 2.6 6.2 2.6s6.2-1.16 6.2-2.6" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}
function WorkspaceIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
      <rect x="3" y="3.5" width="14" height="13" rx="1.8" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 3.5v13" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 8.5h9" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}
function AuditIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
      <rect x="4" y="2.8" width="12" height="14.4" rx="1.6" stroke="currentColor" strokeWidth="1.5" />
      <path d="M7 6.6h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M7 10h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M7 13.4h3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}
const Content = styled.div`
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
`

export function AppShell() {
  const [tab, setTab] = useState<'connections' | 'workspace' | 'audit'>('connections')
  const gateways = useGateways()
  const conns = useConnections(gateways.connection)
  const shell = useOpenConnections(gateways.connection)
  const { forget } = shell

  useEffect(() => {
    // 목록에서 사라진 연결(다른 곳에서 삭제됨)의 셸 상태를 버린다.
    for (const id of Object.keys(shell.open)) {
      if (!conns.connections.some((c) => c.id === id)) forget(id)
    }
  }, [conns.connections, shell.open, forget])

  const rowState = (id: string): ConnectionRowState => shell.open[id]?.state ?? 'closed'

  const sidebar = (
    <ConnectionTree isEmpty={conns.connections.length === 0} onNew={() => setTab('connections')}>
      {conns.connections.map((c) => {
        const state = rowState(c.id)
        return (
          <ConnectionRow
            key={c.id}
            id={c.id}
            name={c.name}
            engine={c.engine}
            state={state}
            expanded={shell.expanded[c.id] === true}
            active={shell.activeId === c.id}
            error={shell.open[c.id]?.error}
            onToggle={() => shell.toggleExpanded(c.id)}
            // 행 클릭은 접속하지 않는다 — 사이드바에서 스치듯 누른 클릭이
            // 프로덕션 접속이 되면 안 된다. 접속은 '연결' 버튼만 한다.
            onRowClick={() => {
              if (state === 'ready') shell.setActive(c.id)
              else shell.toggleExpanded(c.id)
            }}
            onConnect={() => void shell.openConnection(c.id)}
            onClose={() => void shell.closeConnection(c.id)}
            onSettings={() => setTab('connections')}
          />
        )
      })}
    </ConnectionTree>
  )

  const workspace =
    shell.activeId !== null ? (
      <WorkspaceHost
        connections={conns.connections}
        open={shell.open}
        activeId={shell.activeId}
        gateway={gateways.operation}
        ai={gateways.ai}
      />
    ) : (
      <EmptyState
        title={
          conns.connections.length === 0
            ? '연결이 없습니다 — 사이드바의 + 로 추가하세요.'
            : '사이드바에서 연결을 골라 접속하세요.'
        }
      />
    )

  const showSidebar = tab === 'workspace'
  return (
    <Layout $sidebar={showSidebar}>
      <Rail>
        <RailButton
          type="button"
          aria-label="Connections"
          title="Connections"
          $active={tab === 'connections'}
          onClick={() => setTab('connections')}
        >
          <ConnectionsIcon />
        </RailButton>
        <RailButton
          type="button"
          aria-label="Workspace"
          title="Workspace"
          $active={tab === 'workspace'}
          onClick={() => setTab('workspace')}
        >
          <WorkspaceIcon />
        </RailButton>
        <RailButton
          type="button"
          aria-label="Audit"
          title="Audit"
          $active={tab === 'audit'}
          onClick={() => setTab('audit')}
        >
          <AuditIcon />
        </RailButton>
      </Rail>
      {showSidebar && sidebar}
      <Content>
        {tab === 'connections' ? (
          <ConnectionsScreen />
        ) : tab === 'workspace' ? (
          workspace
        ) : (
          <AuditView gateway={gateways.operation} />
        )}
      </Content>
    </Layout>
  )
}
