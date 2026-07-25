import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import styled from 'styled-components'

/** 트리거와 메뉴 사이, 그리고 화면 가장자리와의 최소 간격. */
const GAP = 4

const Trigger = styled.button`
  flex: 0 0 auto;
  padding: 2px 6px;
  border: none;
  border-radius: ${({ theme }) => theme.radius.sm};
  background: transparent;
  color: ${({ theme }) => theme.color.textDim};
  font-family: ${({ theme }) => theme.font.ui};
  font-size: ${({ theme }) => theme.fontSize.md};
  line-height: 1;
  cursor: pointer;
  &:hover,
  &[aria-expanded='true'] {
    background: ${({ theme }) => theme.color.rowHover};
    color: ${({ theme }) => theme.color.text};
  }
`
const Menu = styled.div<{ $pos: { top: number; left: number } | null }>`
  position: fixed;
  z-index: 20;
  display: flex;
  flex-direction: column;
  min-width: 132px;
  padding: ${({ theme }) => theme.space.xs} 0;
  border: 1px solid ${({ theme }) => theme.color.border};
  border-radius: ${({ theme }) => theme.radius.md};
  background: ${({ theme }) => theme.color.panel};
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
  top: ${({ $pos }) => $pos?.top ?? 0}px;
  left: ${({ $pos }) => $pos?.left ?? 0}px;
  /* 자리를 재기 전 한 프레임은 0,0에 있다 — 그 프레임을 보여 주지 않는다. */
  visibility: ${({ $pos }) => ($pos === null ? 'hidden' : 'visible')};
`
const Item = styled.button<{ $danger: boolean }>`
  padding: 5px ${({ theme }) => theme.space.md};
  border: none;
  background: transparent;
  color: ${({ theme, $danger }) => ($danger ? theme.color.red : theme.color.text)};
  font-family: ${({ theme }) => theme.font.ui};
  font-size: ${({ theme }) => theme.fontSize.sm};
  text-align: left;
  white-space: nowrap;
  cursor: pointer;
  &:hover:not(:disabled),
  &:focus-visible {
    background: ${({ theme }) => theme.color.rowHover};
  }
  &:disabled {
    opacity: 0.5;
    cursor: default;
  }
`

export interface RowMenuItem {
  readonly label: string
  readonly onSelect: () => void
  /** 되돌릴 수 없는 항목. 빨간 글자로 그린다. */
  readonly danger?: boolean
  readonly disabled?: boolean
  readonly testId?: string
}

interface RowMenuProps {
  /** 트리거의 이름. 대상을 담아 `users 더 보기`처럼 준다 — 행마다 하나씩 있다. */
  readonly label: string
  readonly items: readonly RowMenuItem[]
  readonly testId?: string
}

/**
 * 목록 행의 보조 동작을 모아 두는 메뉴.
 *
 * 아이콘만 있는 행 버튼을 여러 개 늘어놓는 대신 하나로 접는다 — 사이드바에
 * 연결이 쌓이면 버튼이 이름보다 시끄러워지고, 글리프는 이름이 없어 눌러 보기
 * 전까지 무엇인지 알 수 없다. 메뉴 안에서는 글자 라벨을 쓸 자리가 생긴다.
 *
 * 메뉴는 body로 내보낸다. 사이드바가 `overflow: auto`라 흐름 안에 두면 아래쪽
 * 행에서 잘린다.
 */
export function RowMenu({ label, items, testId }: RowMenuProps) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  const close = useCallback((refocus: boolean) => {
    setOpen(false)
    setPos(null)
    if (refocus) triggerRef.current?.focus()
  }, [])

  // 그려진 뒤 실제 크기로 자리를 정한다. 아래로 넘치면 위로 뒤집고, 좌우는
  // 화면 안으로 물린다.
  useLayoutEffect(() => {
    if (!open) return
    const trigger = triggerRef.current
    const menu = menuRef.current
    if (trigger === null || menu === null) return
    const t = trigger.getBoundingClientRect()
    const m = menu.getBoundingClientRect()
    const below = t.bottom + GAP
    const top = below + m.height > window.innerHeight ? t.top - GAP - m.height : below
    const left = Math.min(t.right - m.width, window.innerWidth - m.width - GAP)
    setPos({ top: Math.max(GAP, top), left: Math.max(GAP, left) })
  }, [open])

  useEffect(() => {
    if (!open) return
    menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: Event) => {
      const target = e.target as Node
      if (menuRef.current?.contains(target) === true) return
      // 트리거를 다시 누른 것이면 그쪽 onClick이 닫는다. 여기서 먼저 닫으면
      // 곧바로 다시 열려 메뉴가 닫히지 않는다.
      if (triggerRef.current?.contains(target) === true) return
      close(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // 행이나 모달이 같은 Escape를 듣고 있어도 메뉴가 먼저 먹는다.
      e.stopPropagation()
      close(true)
    }
    // 스크롤·리사이즈는 좌표를 낡게 만든다. 따라다니게 만드는 대신 닫는다 —
    // 메뉴를 열어 둔 채로 목록을 훑는 흐름은 없다.
    const onViewportChange = () => close(false)
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('scroll', onViewportChange, true)
    window.addEventListener('resize', onViewportChange)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('scroll', onViewportChange, true)
      window.removeEventListener('resize', onViewportChange)
    }
  }, [open, close])

  const onMenuKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const buttons = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [],
    )
    if (buttons.length === 0) return
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement)
    const step = e.key === 'ArrowDown' ? 1 : -1
    buttons[(at + step + buttons.length) % buttons.length]?.focus()
  }

  return (
    <>
      <Trigger
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        data-testid={testId}
        onClick={() => (open ? close(false) : setOpen(true))}
      >
        ⋯
      </Trigger>
      {open &&
        createPortal(
          <Menu ref={menuRef} role="menu" aria-label={label} $pos={pos} onKeyDown={onMenuKeyDown}>
            {items.map((item) => (
              <Item
                key={item.label}
                type="button"
                role="menuitem"
                $danger={item.danger === true}
                disabled={item.disabled === true}
                data-testid={item.testId}
                onClick={() => {
                  // 먼저 닫아 포커스를 트리거로 돌려놓는다. 동작이 다른 곳으로
                  // 포커스를 옮기면 그쪽이 이긴다.
                  close(true)
                  item.onSelect()
                }}
              >
                {item.label}
              </Item>
            ))}
          </Menu>,
          document.body,
        )}
    </>
  )
}
