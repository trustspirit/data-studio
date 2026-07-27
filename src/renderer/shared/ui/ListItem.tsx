import styled from 'styled-components'
import type { ReactNode } from 'react'

const Row = styled.button<{ $active: boolean }>`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.space.sm};
  width: 100%;
  text-align: left;
  font-family: ${({ theme }) => theme.font.ui};
  font-size: ${({ theme }) => theme.fontSize.body};
  padding: ${({ theme }) => theme.density.rowPad};
  border: none;
  cursor: pointer;
  color: ${({ theme, $active }) => ($active ? theme.color.fg.primary : theme.color.fg.dim)};
  background: ${({ theme, $active }) => ($active ? theme.color.surface.base : 'transparent')};
  &:hover {
    background: ${({ theme }) => theme.color.surface.base};
    color: ${({ theme }) => theme.color.fg.primary};
  }
`

interface Props {
  active?: boolean
  onSelect: () => void
  children: ReactNode
}

export function ListItem({ active = false, onSelect, children }: Props) {
  return (
    <Row type="button" $active={active} onClick={onSelect}>
      {children}
    </Row>
  )
}
