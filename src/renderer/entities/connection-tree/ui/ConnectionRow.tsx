import type { ReactNode } from 'react'
import styled from 'styled-components'
import { Icon, RowMenu, type RowMenuItem } from '../../../shared/ui'

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
  /* 상태색은 표면 계단이 아니라 틴트다 — 사이드바가 이미 surface.base라서
     불투명 값을 쓰면 컨테이너와 같은 색이 되어 선택 표시가 사라진다. 활성은
     강조 틴트라 중립 hover와도 구별된다(이름은 늘 text.primary라 글자로는
     구별할 단서가 없다). */
  background: ${({ theme, $active }) => ($active ? theme.color.row.selected : 'transparent')};
  &:hover {
    background: ${({ theme, $active }) =>
      $active ? theme.color.row.selected : theme.color.row.hover};
  }
`
const Chevron = styled.button`
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: ${({ theme }) => theme.size.icon};
  padding: 0;
  border: none;
  background: transparent;
  color: ${({ theme }) => theme.color.text.faint};
  cursor: pointer;
`
/** 셰브런이 없는 행의 자리. 이름이 좌우로 어긋나지 않게 폭만 채운다. */
const ChevronSpace = styled.span`
  flex: 0 0 auto;
  width: ${({ theme }) => theme.size.icon};
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
  color: ${({ theme }) => theme.color.text.primary};
  font: inherit;
  text-align: left;
  cursor: pointer;
`
const Dot = styled.span<{ $state: ConnectionRowState }>`
  flex: 0 0 auto;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: ${({ theme, $state }) =>
    $state === 'ready'
      ? theme.color.intent.success
      : $state === 'error'
        ? theme.color.intent.danger
        : $state === 'connecting'
          ? theme.color.intent.warning
          : theme.color.text.faint};
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
  color: ${({ theme }) => theme.color.text.faint};
  font-size: ${({ theme }) => theme.fontSize.label};
`
const Actions = styled.span`
  display: flex;
  align-items: center;
  gap: 2px;
  flex: 0 0 auto;
`
/**
 * 접속은 닫힌 행에서 사용자가 하려는 단 하나의 일이다. 그래서 hover를 기다리지
 * 않고 늘 버튼처럼 보인다 — 여기를 흐리게 두면 행에서 가장 중요한 것이 가장
 * 안 보이는 상태가 된다.
 */
const Connect = styled.button`
  flex: 0 0 auto;
  padding: 1px 8px;
  border: 1px solid ${({ theme }) => theme.color.border.strong};
  border-radius: ${({ theme }) => theme.radius.sm};
  background: ${({ theme }) => theme.color.surface.panel};
  color: ${({ theme }) => theme.color.text.primary};
  font-family: ${({ theme }) => theme.font.ui};
  font-size: ${({ theme }) => theme.fontSize.label};
  cursor: pointer;
  &:hover {
    border-color: ${({ theme }) => theme.color.intent.accent};
    background: ${({ theme }) => theme.color.surface.base};
  }
`
const RowError = styled.div`
  padding: 2px ${({ theme }) => theme.space.sm} 6px 26px;
  color: ${({ theme }) => theme.color.intent.danger};
  font-size: ${({ theme }) => theme.fontSize.label};
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
  // 펼칠 것이 있는 행은 접속된 행뿐이다. 닫힌 연결에 셰브런을 주면 눌러도 빈
  // 것이 열려 막다른 길이 된다.
  const expandable = state === 'ready'
  // 접속만 행에 남긴다. 나머지는 메뉴 안에서 글자 라벨을 받는다 — 사이드바에
  // 연결이 쌓이면 행마다 늘어선 버튼이 이름보다 시끄럽다.
  const menuItems: readonly RowMenuItem[] = [
    ...(opened
      ? [
          {
            label: '연결 끊기',
            onSelect: onClose,
            disabled: state === 'connecting',
            testId: `close-${id}`,
          },
        ]
      : []),
    { label: '설정', onSelect: onSettings, testId: `settings-${id}` },
  ]
  return (
    <Wrap>
      <Row $active={active}>
        {expandable ? (
          <Chevron
            type="button"
            aria-label={`${name} ${expanded ? '접기' : '펼치기'}`}
            aria-expanded={expanded}
            data-testid={`chevron-${id}`}
            onClick={onToggle}
          >
            <Icon name={expanded ? 'chevronDown' : 'chevronRight'} />
          </Chevron>
        ) : (
          <ChevronSpace aria-hidden />
        )}
        <Label type="button" data-testid={`conn-${id}`} onClick={onRowClick}>
          <Dot $state={state} aria-hidden />
          <Name>{name}</Name>
          <EngineBadge>{engine}</EngineBadge>
        </Label>
        <Actions>
          {!opened && (
            <Connect
              type="button"
              data-testid={`connect-${id}`}
              title={`${name} 연결`}
              onClick={onConnect}
            >
              {state === 'error' ? '재시도' : '연결'}
            </Connect>
          )}
          <RowMenu label={`${name} 더 보기`} items={menuItems} testId={`more-${id}`} />
        </Actions>
      </Row>
      {state === 'error' && error != null && error !== '' && (
        <RowError data-testid={`row-error-${id}`}>{error}</RowError>
      )}
      {expanded && children !== undefined && <Children>{children}</Children>}
    </Wrap>
  )
}
