import { useEffect, useRef } from 'react'
import styled from 'styled-components'
import { Button } from './Button'

const Backdrop = styled.div`
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.45);
  z-index: 10;
`
const Card = styled.div`
  min-width: 320px;
  max-width: 420px;
  padding: ${({ theme }) => theme.space.lg};
  border-radius: ${({ theme }) => theme.radius.lg};
  background: ${({ theme }) => theme.color.panel};
  border: 1px solid ${({ theme }) => theme.color.border};
  font-family: ${({ theme }) => theme.font.ui};
  color: ${({ theme }) => theme.color.text};
`
const Title = styled.h3`
  margin: 0 0 ${({ theme }) => theme.space.sm};
  font-size: ${({ theme }) => theme.fontSize.md};
`
const Message = styled.p`
  margin: 0 0 ${({ theme }) => theme.space.lg};
  font-size: ${({ theme }) => theme.fontSize.sm};
  color: ${({ theme }) => theme.color.textDim};
`
const Actions = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: ${({ theme }) => theme.space.sm};
`

interface ConfirmDialogProps {
  title: string
  message: string
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
  testId?: string | undefined
}

/**
 * 파괴적인 동작(닫기 등) 전에 확인을 받는 모달. Escape로 취소할 수 있어야 한다.
 *
 * 이 다이얼로그를 여는 트리거(탭의 × 컨트롤 등)는 이 컴포넌트의 자식이 아니라
 * `Backdrop`의 형제다 — 클릭이 DOM 포커스를 그 트리거에 남기고, keydown은
 * 실제 조상 체인을 따라 버블링하므로 `Backdrop`에 핸들러를 다는 것만으로는
 * 포커스가 트리거에 남아 있는 한 Escape가 절대 여기까지 오지 않는다. 그래서
 * (1) 마운트 시 포커스를 다이얼로그 안(취소 버튼)으로 옮기고, (2) 마운트 동안
 * `document`에 직접 keydown 리스너를 달아 포커스 위치와 무관하게 Escape를
 * 잡는다.
 */
export function ConfirmDialog({ title, message, confirmLabel, onConfirm, onCancel, testId }: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null)
  // onCancel이 매 렌더 새 함수여도(호출부가 안정화하지 않았어도) 아래 document
  // 리스너는 마운트 때 한 번만 붙는다 — 그래서 항상 최신 onCancel을 참조하도록
  // ref에 매 렌더 동기화해 둔다. 리스너 쪽에서 deps 없이 ref.current만 읽는다.
  const onCancelRef = useRef(onCancel)
  useEffect(() => {
    onCancelRef.current = onCancel
  }, [onCancel])

  useEffect(() => {
    cancelRef.current?.focus()
    const onDocumentKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancelRef.current()
    }
    document.addEventListener('keydown', onDocumentKeyDown)
    return () => document.removeEventListener('keydown', onDocumentKeyDown)
  }, [])

  return (
    <Backdrop
      role="dialog"
      aria-modal="true"
      aria-label={title}
      {...(testId !== undefined ? { 'data-testid': testId } : {})}
    >
      <Card>
        <Title>{title}</Title>
        <Message>{message}</Message>
        <Actions>
          <Button
            ref={cancelRef}
            type="button"
            variant="secondary"
            size="sm"
            {...(testId !== undefined ? { 'data-testid': `${testId}-cancel` } : {})}
            onClick={onCancel}
          >
            취소
          </Button>
          <Button
            type="button"
            size="sm"
            {...(testId !== undefined ? { 'data-testid': `${testId}-ok` } : {})}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </Actions>
      </Card>
    </Backdrop>
  )
}
