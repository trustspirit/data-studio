import { useEffect, useState } from 'react'
import styled from 'styled-components'
import { useGateways } from './GatewayProvider'
import { useConnections } from '../features/connections/model/useConnections'
import { ConnectionsScreen } from '../features/connections'
import { QueryWorkspace } from '../features/query'
import { Button } from '../shared/ui'

const Layout = styled.div`
  display: grid;
  grid-template-columns: 56px 1fr;
  height: 100vh;
  background: ${({ theme }) => theme.color.winBg};
  color: ${({ theme }) => theme.color.text};
`
const Rail = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 4px;
  background: ${({ theme }) => theme.color.toolbar};
  border-right: 1px solid ${({ theme }) => theme.color.border};
`
const RailButton = styled.button<{ $active: boolean }>`
  font: ${({ theme }) => theme.font.ui};
  font-size: 11px;
  padding: 8px 4px;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  color: ${({ theme, $active }) => ($active ? theme.color.text : theme.color.textDim)};
  background: ${({ theme, $active }) => ($active ? theme.color.panel : 'transparent')};
`
const Picker = styled.div`
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  font: ${({ theme }) => theme.font.ui};
`
const Row = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
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
const Banner = styled.div`
  color: ${({ theme }) => theme.color.red};
  font-size: 13px;
`

function QueryTab() {
  const gateways = useGateways()
  const conns = useConnections(gateways.connection)
  const [openId, setOpenId] = useState<string | null>(null)
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
    setOpenId(id)
  }

  useEffect(() => {
    if (openId !== null && !conns.connections.some((c) => c.id === openId)) setOpenId(null)
  }, [conns.connections, openId])

  const active = conns.connections.find((c) => c.id === openId) ?? null
  if (active !== null) {
    return (
      <QueryWorkspace gateway={gateways.operation} connectionId={active.id} connectionName={active.name} />
    )
  }
  return (
    <Picker>
      {openError !== null && <Banner>{openError}</Banner>}
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
  const [tab, setTab] = useState<'connections' | 'query'>('connections')
  return (
    <Layout>
      <Rail>
        <RailButton type="button" $active={tab === 'connections'} onClick={() => setTab('connections')}>
          Connections
        </RailButton>
        <RailButton type="button" $active={tab === 'query'} onClick={() => setTab('query')}>
          Query
        </RailButton>
      </Rail>
      {tab === 'connections' ? <ConnectionsScreen /> : <QueryTab />}
    </Layout>
  )
}
