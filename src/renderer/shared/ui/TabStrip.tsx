import type { ReactNode } from 'react'
import styled from 'styled-components'

const Strip = styled.div`
  display: flex;
  align-items: stretch;
  gap: ${({ theme }) => theme.space.xs};
  padding: 0 ${({ theme }) => theme.space.sm};
  border-bottom: 1px solid ${({ theme }) => theme.color.border.soft};
  background: ${({ theme }) => theme.color.surface.bg};
`
/** 탭 하나의 묶음. role="presentation"이라 tablist가 소유하는 것은 tab뿐이다. */
const Slot = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.space.xs};
  padding-right: ${({ theme }) => theme.space.xs};
  border-bottom: 2px solid transparent;

  &[data-active='true'] {
    border-bottom-color: ${({ theme }) => theme.color.intent.accent};
  }
`
const Tab = styled.button`
  font-family: ${({ theme }) => theme.font.ui};
  font-size: ${({ theme }) => theme.fontSize.body};
  padding: 9px 4px 7px ${({ theme }) => theme.space.sm};
  background: transparent;
  border: 0;
  cursor: pointer;
  white-space: nowrap;
  color: ${({ theme }) => theme.color.text.dim};

  &[aria-selected='true'] {
    color: ${({ theme }) => theme.color.text.primary};
  }
  &:hover {
    color: ${({ theme }) => theme.color.text.primary};
  }
`
const Close = styled.button`
  font-family: ${({ theme }) => theme.font.ui};
  font-size: ${({ theme }) => theme.fontSize.label};
  line-height: 1;
  padding: 2px 4px;
  background: transparent;
  border: 0;
  border-radius: ${({ theme }) => theme.radius.sm};
  cursor: pointer;
  /* 자리는 늘 차지하되 활성·hover에서만 보인다 — 폭이 흔들리면 안 된다. */
  opacity: 0;
  color: ${({ theme }) => theme.color.text.faint};

  ${Slot}[data-active='true'] &,
  ${Slot}:hover & {
    opacity: 1;
  }
  &:hover,
  &:focus-visible {
    opacity: 1;
    background: ${({ theme }) => theme.color.surface.base};
    color: ${({ theme }) => theme.color.text.primary};
  }
`
const Dirty = styled.span`
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: ${({ theme }) => theme.color.intent.warning};
`

export interface TabDescriptor {
  readonly key: string
  readonly title: string
  readonly dirty?: boolean | undefined
}

interface TabStripProps {
  tabs: readonly TabDescriptor[]
  activeKey: string | null
  onActivate: (key: string) => void
  onClose: (key: string) => void
  label: string
  trailing?: ReactNode | undefined
  /** 셸 테스트가 기대하는 testid 접두사. 기본은 'tab'; DocumentTabBar는 'doctab'을 넘긴다. */
  testIdPrefix?: string | undefined
}

export function TabStrip({
  tabs,
  activeKey,
  onActivate,
  onClose,
  label,
  trailing,
  testIdPrefix = 'tab',
}: TabStripProps) {
  return (
    <Strip role="tablist" aria-label={label}>
      {tabs.map((tab) => {
        const active = tab.key === activeKey
        return (
          <Slot key={tab.key} role="presentation" data-active={active}>
            <Tab
              type="button"
              role="tab"
              aria-selected={active}
              data-testid={`${testIdPrefix}-${tab.key}`}
              onClick={() => onActivate(tab.key)}
            >
              {tab.title}
            </Tab>
            {tab.dirty === true && (
              <Dirty data-testid={`${testIdPrefix}-dirty-${tab.key}`} aria-label="적용하지 않은 편집" />
            )}
            <Close
              type="button"
              aria-label={`${tab.title} 닫기`}
              data-testid={`${testIdPrefix}-close-${tab.key}`}
              onClick={() => onClose(tab.key)}
            >
              ✕
            </Close>
          </Slot>
        )
      })}
      {trailing}
    </Strip>
  )
}
