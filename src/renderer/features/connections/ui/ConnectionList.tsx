import styled from 'styled-components'
import type { ConnectionConfig } from '@shared/types/connection'
import { Button, ListItem } from '../../../shared/ui'

const Wrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px;
  background: ${({ theme }) => theme.color.sidebar};
  height: 100%;
  box-sizing: border-box;
`
const Header = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: ${({ theme }) => theme.color.textDim};
  font: ${({ theme }) => theme.font.ui};
  font-size: 12px;
  text-transform: uppercase;
`
const Sub = styled.span`
  color: ${({ theme }) => theme.color.textFaint};
  font-size: 11px;
  margin-left: 8px;
`

interface Props {
  connections: readonly ConnectionConfig[]
  selectedId: string | null
  onSelect: (id: string) => void
  onNew: () => void
}

export function ConnectionList({ connections, selectedId, onSelect, onNew }: Props) {
  return (
    <Wrap>
      <Header>
        Connections
        <Button variant="secondary" onClick={onNew}>
          + New
        </Button>
      </Header>
      {connections.map((c) => (
        <ListItem key={c.id} active={c.id === selectedId} onSelect={() => onSelect(c.id)}>
          {c.name}
          <Sub>{c.engine}</Sub>
        </ListItem>
      ))}
    </Wrap>
  )
}
