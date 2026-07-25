import { useEffect, useState } from 'react'
import styled from 'styled-components'
import { useGateways } from './GatewayProvider'
import { useConnections } from '../features/connections/model/useConnections'
import { ConnectionsScreen } from '../features/connections'
import { ConnectionWorkspace } from './ConnectionWorkspace'
import { Button, ErrorBanner } from '../shared/ui'
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
  gap: ${({ theme }) => theme.space.xs};
  padding: ${({ theme }) => `${theme.space.sm} ${theme.space.xs}`};
  background: ${({ theme }) => theme.color.toolbar};
  border-right: 1px solid ${({ theme }) => theme.color.border};
`
const RailButton = styled.button<{ $active: boolean }>`
  font-family: ${({ theme }) => theme.font.ui};
  font-size: ${({ theme }) => theme.fontSize.xs};
  padding: 8px 4px;
  border: none;
  border-radius: ${({ theme }) => theme.radius.md};
  cursor: pointer;
  color: ${({ theme, $active }) => ($active ? theme.color.text : theme.color.textDim)};
  background: ${({ theme, $active }) => ($active ? theme.color.panel : 'transparent')};
  &:hover {
    color: ${({ theme }) => theme.color.text};
  }
`
const Content = styled.div`
  min-width: 0;
  min-height: 0;
  overflow: hidden;
`
const Picker = styled.div`
  padding: ${({ theme }) => theme.space.lg};
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.space.sm};
  font-family: ${({ theme }) => theme.font.ui};
  overflow: auto;
  height: 100%;
`
const Row = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.space.sm};
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
        connectionId={active.id}
        connectionName={active.name}
        capabilities={openCaps}
      />
    )
  }
  return (
    <Picker>
      {openError !== null && <ErrorBanner>{openError}</ErrorBanner>}
      {conns.connections.map((c) => (
        <Row key={c.id}>
          <Dot $status={statuses[c.id] ?? 'closed'} />
          <Name>{c.name}</Name>
          <Button data-testid={`open-${c.id}`} onClick={() => void open(c.id)}>
            Open
          </Button>
        </Row>
      ))}
      {conns.connections.length === 0 && <span>연결이 없습니다. Connections 탭에서 추가하세요.</span>}
    </Picker>
  )
}

export function AppShell() {
  const [tab, setTab] = useState<'connections' | 'workspace'>('connections')
  return (
    <Layout>
      <Rail>
        <RailButton type="button" $active={tab === 'connections'} onClick={() => setTab('connections')}>
          Connections
        </RailButton>
        <RailButton type="button" $active={tab === 'workspace'} onClick={() => setTab('workspace')}>
          Workspace
        </RailButton>
      </Rail>
      <Content>{tab === 'connections' ? <ConnectionsScreen /> : <QueryTab />}</Content>
    </Layout>
  )
}
