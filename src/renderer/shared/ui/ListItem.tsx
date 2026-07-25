import styled from 'styled-components'
import type { ReactNode } from 'react'

const Row = styled.button<{ $active: boolean }>`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.space.sm};
  width: 100%;
  text-align: left;
  font-family: ${({ theme }) => theme.font.ui};
  font-size: ${({ theme }) => theme.fontSize.sm};
  padding: ${({ theme }) => theme.density.rowPad};
  border: none;
  cursor: pointer;
  color: ${({ theme, $active }) => ($active ? theme.color.text : theme.color.textDim)};
  background: ${({ theme, $active }) => ($active ? theme.color.rowHover : 'transparent')};
  &:hover {
    background: ${({ theme }) => theme.color.rowHover};
    color: ${({ theme }) => theme.color.text};
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
