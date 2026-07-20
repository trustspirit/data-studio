import styled from 'styled-components'
import type { ReactNode } from 'react'

const Row = styled.button<{ $active: boolean }>`
  display: block;
  width: 100%;
  text-align: left;
  font: ${({ theme }) => theme.font.ui};
  padding: ${({ theme }) => theme.density.rowPad};
  border: none;
  cursor: pointer;
  color: ${({ theme }) => theme.color.text};
  background: ${({ theme, $active }) => ($active ? theme.color.rowHover : 'transparent')};
  &:hover {
    background: ${({ theme }) => theme.color.rowHover};
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
