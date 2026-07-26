import type { KeyboardEvent } from 'react'
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

/** 파괴적인 동작(닫기 등) 전에 확인을 받는 모달. Escape로 취소할 수 있어야 한다. */
export function ConfirmDialog({ title, message, confirmLabel, onConfirm, onCancel, testId }: ConfirmDialogProps) {
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') onCancel()
  }
  return (
    <Backdrop
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onKeyDown={onKeyDown}
      {...(testId !== undefined ? { 'data-testid': testId } : {})}
    >
      <Card>
        <Title>{title}</Title>
        <Message>{message}</Message>
        <Actions>
          <Button
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
