import { useEffect, useRef } from 'react'
import type { ReactNode, RefObject } from 'react'
import styled from 'styled-components'

const Backdrop = styled.div`
  position: fixed;
  inset: 0;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 8vh 16px 16px;
  background: rgba(0, 0, 0, 0.4);
  z-index: 10;
`
const Panel = styled.div`
  width: min(680px, 100%);
  max-height: 84vh;
  display: flex;
  flex-direction: column;
  background: ${({ theme }) => theme.color.surface.raised};
  border: 1px solid ${({ theme }) => theme.color.border.strong};
  border-radius: ${({ theme }) => theme.radius.lg};
  box-shadow: 0 14px 40px rgba(0, 0, 0, 0.7);
  overflow: hidden;
`
const Head = styled.div`
  padding: ${({ theme }) => `${theme.space.md} ${theme.space.lg} ${theme.space.sm}`};
  font-family: ${({ theme }) => theme.font.ui};
  font-size: ${({ theme }) => theme.fontSize.heading};
  font-weight: ${({ theme }) => theme.fontWeight.semibold};
  color: ${({ theme }) => theme.color.text.primary};
`
const Body = styled.div`
  overflow: auto;
  min-height: 0;
  padding: ${({ theme }) => `0 ${theme.space.lg} ${theme.space.md}`};
  font-family: ${({ theme }) => theme.font.ui};
  font-size: ${({ theme }) => theme.fontSize.body};
  color: ${({ theme }) => theme.color.text.dim};
  line-height: 1.6;
`
const Foot = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.space.sm};
  justify-content: flex-end;
  padding: ${({ theme }) => `${theme.space.sm} ${theme.space.lg}`};
  background: ${({ theme }) => theme.color.surface.panel};
  border-top: 1px solid ${({ theme }) => theme.color.border.strong};
`

interface DialogProps {
  title: string
  onClose: () => void
  footer: ReactNode
  children: ReactNode
  testId?: string | undefined
  dismissOnBackdrop?: boolean | undefined
  initialFocusRef?: RefObject<HTMLElement | null> | undefined
}

export function Dialog({
  title,
  onClose,
  footer,
  children,
  testId,
  dismissOnBackdrop = true,
  initialFocusRef,
}: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    // document에 건다. 다이얼로그를 여는 컨트롤(탭의 닫기 버튼 등)은 다이얼로그의
    // **형제**라 포커스가 거기 남으면 컴포넌트 내부 핸들러에는 키가 도달하지 않는다.
    const onKeyDown = (e: KeyboardEvent) => {
      const dialogs = document.querySelectorAll('[role="dialog"]')
      if (dialogs[dialogs.length - 1] !== panelRef.current || e.defaultPrevented) return
      if (e.key === 'Escape') { e.preventDefault(); closeRef.current() }
      if (e.key !== 'Tab') return
      const controls = Array.from(panelRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]') ?? [])
        .filter((control) => control.closest('[hidden]') === null)
      const first = controls[0]
      const last = controls[controls.length - 1]
      if (first === undefined || last === undefined) { e.preventDefault(); panelRef.current?.focus(); return }
      if (!panelRef.current?.contains(document.activeElement) || (e.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current))) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && (document.activeElement === last || document.activeElement === panelRef.current)) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const target = initialFocusRef?.current ?? panelRef.current
    target?.focus()
    return () => { if (previous?.isConnected) previous.focus() }
  }, [initialFocusRef])

  return (
    <Backdrop
      {...(testId !== undefined ? { 'data-testid': testId } : {})}
      onClick={() => {
        if (dismissOnBackdrop) onClose()
      }}
    >
      <Panel
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <Head>{title}</Head>
        <Body>{children}</Body>
        <Foot>{footer}</Foot>
      </Panel>
    </Backdrop>
  )
}
