import { useEffect, useState } from 'react'
import styled from 'styled-components'
import { useGateways } from './GatewayProvider'
import { useConnections } from '../features/connections/model/useConnections'
import { ConnectionsScreen } from '../features/connections'
import { ConnectionWorkspace } from './ConnectionWorkspace'
import { Button, EmptyState, ErrorBanner } from '../shared/ui'
import type { Capability } from '../../shared/types/capability'

const Layout = styled.div`
  display: grid;
  grid-template-columns: ${({ theme }) => theme.size.rail} 1fr;
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
const Content = styled.div`
  min-width: 0;
  min-height: 0;
  overflow: hidden;
`
const Picker = styled.div`
  padding: ${({ theme }) => theme.space.xl};
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.space.sm};
  width: 100%;
  max-width: 640px;
  margin: 0 auto;
  font-family: ${({ theme }) => theme.font.ui};
  overflow: auto;
  height: 100%;
`
const PickerTitle = styled.h2`
  margin: 0 0 ${({ theme }) => theme.space.xs};
  font-size: ${({ theme }) => theme.fontSize.sm};
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: ${({ theme }) => theme.color.textDim};
`
const Row = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.space.md};
  padding: ${({ theme }) => `${theme.space.sm} ${theme.space.md}`};
  border: 1px solid ${({ theme }) => theme.color.borderSoft};
  border-radius: ${({ theme }) => theme.radius.md};
  background: ${({ theme }) => theme.color.panel};
`
const Dot = styled.span<{ $status: string }>`
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: ${({ theme, $status }) =>
    $status === 'ready' ? theme.color.green : $status === 'error' ? theme.color.red : theme.color.textFaint};
`
const Name = styled.span`
  flex: 1;
`
const EngineBadge = styled.span`
  padding: 1px 8px;
  border-radius: 999px;
  border: 1px solid ${({ theme }) => theme.color.border};
  color: ${({ theme }) => theme.color.textFaint};
  font-size: ${({ theme }) => theme.fontSize.xs};
`

function QueryTab() {
  const gateways = useGateways()
  const conns = useConnections(gateways.connection)
  const [openId, setOpenId] = useState<string | null>(null)
  const [openCaps, setOpenCaps] = useState<readonly Capability[]>([])
  const [statuses, setStatuses] = useState<Readonly<Record<string, string>>>({})
  const [openError, setOpenError] = useState<string | null>(null)

  const open = async (id: string) => {
    setOpenError(null)
    const result = await gateways.connection.open(id)
    if (!result.opened) {
      setOpenError(result.reason)
      return
    }
    const status = await gateways.connection.status(id)
    setStatuses((s) => ({ ...s, [id]: status }))
    setOpenCaps(result.capabilities)
    setOpenId(id)
  }

  useEffect(() => {
    if (openId !== null && !conns.connections.some((c) => c.id === openId)) setOpenId(null)
  }, [conns.connections, openId])

  const active = conns.connections.find((c) => c.id === openId) ?? null
  if (active !== null) {
    return (
      <ConnectionWorkspace
        gateway={gateways.operation}
        ai={gateways.ai}
        connectionId={active.id}
        connectionName={active.name}
        capabilities={openCaps}
        engine={active.engine}
      />
    )
  }
  return (
    <Picker>
      <PickerTitle>Workspace — 연결 선택</PickerTitle>
      {openError !== null && <ErrorBanner>{openError}</ErrorBanner>}
      {conns.connections.map((c) => (
        <Row key={c.id}>
          <Dot $status={statuses[c.id] ?? 'closed'} />
          <Name>{c.name}</Name>
          <EngineBadge>{c.engine}</EngineBadge>
          <Button size="sm" data-testid={`open-${c.id}`} onClick={() => void open(c.id)}>
            Open
          </Button>
        </Row>
      ))}
      {conns.connections.length === 0 && (
        <EmptyState title="연결이 없습니다. Connections 탭에서 추가하세요." />
      )}
    </Picker>
  )
}

export function AppShell() {
  const [tab, setTab] = useState<'connections' | 'workspace'>('connections')
  return (
    <Layout>
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
      </Rail>
      <Content>{tab === 'connections' ? <ConnectionsScreen /> : <QueryTab />}</Content>
    </Layout>
  )
}
