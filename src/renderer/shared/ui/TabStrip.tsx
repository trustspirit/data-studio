import type { ReactNode } from 'react'
import styled from 'styled-components'
import { Icon } from './Icon'

const Strip = styled.div`
  display: flex;
  align-items: stretch;
  flex-shrink: 0;
  min-height: 42px;
  overflow-x: auto;
  scrollbar-width: thin;
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
  flex-shrink: 0;
  min-width: 120px;
  max-width: 260px;
  border-right: 1px solid ${({ theme }) => theme.color.border.soft};

  &[data-active='true'] {
    border-bottom-color: ${({ theme }) => theme.color.intent.accent};
    background: ${({ theme }) => theme.color.surface.base};
  }
`
const Tab = styled.button`
  font-family: ${({ theme }) => theme.font.ui};
  font-size: ${({ theme }) => theme.fontSize.label};
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
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
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 2px;
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
              tabIndex={active || activeKey === null ? 0 : -1}
              title={tab.title}
              onKeyDown={(event) => {
                const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End']
                if (!keys.includes(event.key)) return
                event.preventDefault()
                const index = tabs.findIndex((item) => item.key === tab.key)
                const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
                  : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
                const target = tabs[next]
                if (target === undefined) return
                onActivate(target.key)
                const list = event.currentTarget.closest('[role="tablist"]')
                list?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus()
              }}
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
              <Icon name="close" />
            </Close>
          </Slot>
        )
      })}
      {trailing}
    </Strip>
  )
}
