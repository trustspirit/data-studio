import type { ReactNode } from 'react'
import styled from 'styled-components'

/** 트리 행이 그리는 연결의 상태. 셸의 `OpenState`에 '닫힘'을 더한 것. */
export type ConnectionRowState = 'closed' | 'connecting' | 'ready' | 'error'

const Wrap = styled.div`
  display: flex;
  flex-direction: column;
`
const Row = styled.div<{ $active: boolean }>`
  display: flex;
  align-items: center;
  gap: 2px;
  padding-right: ${({ theme }) => theme.space.xs};
  background: ${({ theme, $active }) => ($active ? theme.color.rowHover : 'transparent')};
  &:hover {
    background: ${({ theme }) => theme.color.rowHover};
  }
`
const Chevron = styled.button`
  flex: 0 0 auto;
  width: 18px;
  padding: 4px 0;
  border: none;
  background: transparent;
  color: ${({ theme }) => theme.color.textFaint};
  font: inherit;
  cursor: pointer;
`
const Label = styled.button`
  flex: 1;
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.space.sm};
  min-width: 0;
  padding: 4px 0;
  border: none;
  background: transparent;
  color: ${({ theme }) => theme.color.text};
  font: inherit;
  text-align: left;
  cursor: pointer;
`
const Dot = styled.span<{ $state: ConnectionRowState }>`
  flex: 0 0 auto;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: ${({ theme, $state }) =>
    $state === 'ready'
      ? theme.color.green
      : $state === 'error'
        ? theme.color.red
        : $state === 'connecting'
          ? theme.color.orange
          : theme.color.textFaint};
`
const Name = styled.span`
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`
const EngineBadge = styled.span`
  flex: 0 0 auto;
  color: ${({ theme }) => theme.color.textFaint};
  font-size: ${({ theme }) => theme.fontSize.xs};
`
/**
 * 행 액션은 평소 흐릿하게 두고 hover·포커스에서 또렷해진다. 사이드바에 연결이
 * 여럿 쌓이면 버튼이 이름보다 시끄러워지기 때문인데, DOM에서 빼지는 않는다 —
 * 키보드 사용자가 Tab으로 닿을 수 있어야 한다.
 */
const Actions = styled.span`
  display: flex;
  align-items: center;
  gap: 2px;
  flex: 0 0 auto;
  opacity: 0.35;
  ${Row}:hover &,
  ${Row}:focus-within & {
    opacity: 1;
  }
`
const Action = styled.button`
  padding: 2px 6px;
  border: none;
  border-radius: ${({ theme }) => theme.radius.sm};
  background: transparent;
  color: ${({ theme }) => theme.color.textDim};
  font-family: ${({ theme }) => theme.font.ui};
  font-size: ${({ theme }) => theme.fontSize.xs};
  cursor: pointer;
  &:hover {
    background: ${({ theme }) => theme.color.panel};
    color: ${({ theme }) => theme.color.text};
  }
`
const RowError = styled.div`
  padding: 2px ${({ theme }) => theme.space.sm} 6px 26px;
  color: ${({ theme }) => theme.color.red};
  font-size: ${({ theme }) => theme.fontSize.xs};
  word-break: break-word;
`
const Children = styled.div`
  display: flex;
  flex-direction: column;
`

interface ConnectionRowProps {
  id: string
  name: string
  engine: string
  state: ConnectionRowState
  expanded: boolean
  /** 메인 영역이 이 연결을 보여 주고 있는가. */
  active: boolean
  error?: string | null | undefined
  /** 셰브런 — 펼침만 바꾼다. */
  onToggle: () => void
  /** 행 본문 클릭. 접속 여부는 호출자가 정한다(스치듯 누른 클릭이 접속이 되면 안 된다). */
  onRowClick: () => void
  onConnect: () => void
  onClose: () => void
  onSettings: () => void
  children?: ReactNode
}

export function ConnectionRow({
  id,
  name,
  engine,
  state,
  expanded,
  active,
  error,
  onToggle,
  onRowClick,
  onConnect,
  onClose,
  onSettings,
  children,
}: ConnectionRowProps) {
  const opened = state === 'ready' || state === 'connecting'
  return (
    <Wrap>
      <Row $active={active}>
        <Chevron
          type="button"
          aria-label={`${name} ${expanded ? '접기' : '펼치기'}`}
          aria-expanded={expanded}
          data-testid={`chevron-${id}`}
          onClick={onToggle}
        >
          {expanded ? '▾' : '▸'}
        </Chevron>
        <Label type="button" data-testid={`conn-${id}`} onClick={onRowClick}>
          <Dot $state={state} aria-hidden />
          <Name>{name}</Name>
          <EngineBadge>{engine}</EngineBadge>
        </Label>
        <Actions>
          {!opened && (
            <Action
              type="button"
              data-testid={`connect-${id}`}
              title={`${name} 연결`}
              onClick={onConnect}
            >
              {state === 'error' ? '재시도' : '연결'}
            </Action>
          )}
          {opened && (
            <Action
              type="button"
              data-testid={`close-${id}`}
              title={`${name} 연결 끊기`}
              onClick={onClose}
              disabled={state === 'connecting'}
            >
              닫기
            </Action>
          )}
          <Action
            type="button"
            data-testid={`settings-${id}`}
            aria-label={`${name} 설정`}
            onClick={onSettings}
          >
            ⚙
          </Action>
        </Actions>
      </Row>
      {state === 'error' && error != null && error !== '' && (
        <RowError data-testid={`row-error-${id}`}>{error}</RowError>
      )}
      {expanded && children !== undefined && <Children>{children}</Children>}
    </Wrap>
  )
}
