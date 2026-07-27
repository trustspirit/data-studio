import type { ReactNode } from 'react'
import styled from 'styled-components'
import { Sidebar } from '../../../shared/ui'

const Wrap = styled(Sidebar)`
  color: ${({ theme }) => theme.color.fg.primary};
`
const Header = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.space.sm};
  padding: ${({ theme }) => `${theme.space.sm} ${theme.space.xs} ${theme.space.sm} ${theme.space.md}`};
  color: ${({ theme }) => theme.color.fg.dim};
  font-size: ${({ theme }) => theme.fontSize.label};
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
`
const Title = styled.span`
  flex: 1;
`
const AddButton = styled.button`
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  border-radius: ${({ theme }) => theme.radius.sm};
  background: transparent;
  color: ${({ theme }) => theme.color.fg.dim};
  font-family: ${({ theme }) => theme.font.ui};
  font-size: ${({ theme }) => theme.fontSize.heading};
  line-height: 1;
  cursor: pointer;
  &:hover {
    background: ${({ theme }) => theme.color.surface.panel};
    color: ${({ theme }) => theme.color.fg.primary};
  }
`
const Empty = styled.div`
  padding: ${({ theme }) => `${theme.space.sm} ${theme.space.md}`};
  color: ${({ theme }) => theme.color.fg.faint};
  font-size: ${({ theme }) => theme.fontSize.label};
  line-height: 1.5;
`

interface ConnectionTreeProps {
  isEmpty: boolean
  onNew: () => void
  children?: ReactNode
}

/**
 * 사이드바 통합 트리의 껍데기. 연결 행과 그 아래 스키마 하위 트리는 전부
 * `children`으로 들어온다 — 이 컴포넌트는 무엇이 열려 있는지 모른다.
 */
export function ConnectionTree({ isEmpty, onNew, children }: ConnectionTreeProps) {
  return (
    <Wrap data-testid="connection-tree">
      <Header>
        <Title>Connections</Title>
        <AddButton type="button" aria-label="새 연결" title="새 연결" onClick={onNew}>
          +
        </AddButton>
      </Header>
      {isEmpty ? <Empty>연결이 없습니다 — 위의 +로 추가하세요.</Empty> : children}
    </Wrap>
  )
}
