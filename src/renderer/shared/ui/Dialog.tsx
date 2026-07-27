import { useEffect, useRef } from 'react'
import type { ReactNode, RefObject } from 'react'
import styled from 'styled-components'

const Backdrop = styled.div`
  position: absolute;
  inset: 0;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 10vh;
  background: rgba(0, 0, 0, 0.4);
  z-index: 10;
`
const Panel = styled.div`
  min-width: 320px;
  max-width: 520px;
  background: ${({ theme }) => theme.color.surface.raised};
  border: 1px solid ${({ theme }) => theme.color.borders.strong};
  border-radius: ${({ theme }) => theme.radius.lg};
  box-shadow: 0 14px 40px rgba(0, 0, 0, 0.7);
  overflow: hidden;
`
const Head = styled.div`
  padding: ${({ theme }) => `${theme.space.md} ${theme.space.lg} ${theme.space.sm}`};
  font-family: ${({ theme }) => theme.font.ui};
  font-size: ${({ theme }) => theme.fontSize.heading};
  font-weight: ${({ theme }) => theme.fontWeight.semibold};
  color: ${({ theme }) => theme.color.fg.primary};
`
const Body = styled.div`
  padding: ${({ theme }) => `0 ${theme.space.lg} ${theme.space.md}`};
  font-family: ${({ theme }) => theme.font.ui};
  font-size: ${({ theme }) => theme.fontSize.body};
  color: ${({ theme }) => theme.color.fg.dim};
  line-height: 1.6;
`
const Foot = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.space.sm};
  justify-content: flex-end;
  padding: ${({ theme }) => `${theme.space.sm} ${theme.space.lg}`};
  background: ${({ theme }) => theme.color.surface.panel};
  border-top: 1px solid ${({ theme }) => theme.color.borders.strong};
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
      if (e.key === 'Escape') closeRef.current()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    const target = initialFocusRef?.current ?? panelRef.current
    target?.focus()
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
