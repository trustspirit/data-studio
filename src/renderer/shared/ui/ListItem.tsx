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
  color: ${({ theme, $active }) => ($active ? theme.color.text.primary : theme.color.text.dim)};
  /* 행 상태는 틴트로만 준다 — 리스트가 어느 표면 위에 놓이든 한 단 들어올린다. */
  background: ${({ theme, $active }) => ($active ? theme.color.row.selected : 'transparent')};
  &:hover {
    background: ${({ theme, $active }) =>
      $active ? theme.color.row.selected : theme.color.row.hover};
    color: ${({ theme }) => theme.color.text.primary};
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
