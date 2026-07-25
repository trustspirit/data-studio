import styled from 'styled-components'
import type { ConnectionConfig } from '@shared/types/connection'
import { Button, ListItem } from '../../../shared/ui'

const Wrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.space.sm};
  padding: ${({ theme }) => theme.space.sm};
  background: ${({ theme }) => theme.color.sidebar};
  border-right: 1px solid ${({ theme }) => theme.color.border};
  height: 100%;
  min-height: 0;
  overflow: auto;
`
const Header = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: ${({ theme }) => theme.color.textDim};
  font-family: ${({ theme }) => theme.font.ui};
  font-size: ${({ theme }) => theme.fontSize.sm};
  text-transform: uppercase;
`
const Sub = styled.span`
  margin-left: auto;
  color: ${({ theme }) => theme.color.textFaint};
  font-size: ${({ theme }) => theme.fontSize.xs};
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
        <Button variant="secondary" size="sm" onClick={onNew}>
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
