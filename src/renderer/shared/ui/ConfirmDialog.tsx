import { useRef } from 'react'
import { Button } from './Button'
import { Dialog } from './Dialog'

interface ConfirmDialogProps {
  title: string
  message: string
  confirmLabel: string
  testId?: string | undefined
  onCancel: () => void
  onConfirm: () => void
}

/**
 * 파괴적인 동작(닫기 등) 전에 확인을 받는 모달. `Dialog` 위에 얹는다 — Escape
 * 처리와 마운트 시 포커스 이동은 `Dialog`의 document 레벨 리스너 계약을 그대로
 * 물려받는다(자세한 이유는 `Dialog.tsx` 주석 참고).
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  testId,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null)
  return (
    <Dialog
      title={title}
      onClose={onCancel}
      // 파괴적 확인은 배경 클릭으로 닫지 않는다 — 실수로 스친 클릭이
      // 취소로 읽히면 사용자는 자기가 무엇을 했는지 모른다.
      dismissOnBackdrop={false}
      initialFocusRef={cancelRef}
      {...(testId !== undefined ? { testId } : {})}
      footer={
        <>
          <Button
            ref={cancelRef}
            type="button"
            variant="ghost"
            {...(testId !== undefined ? { 'data-testid': `${testId}-cancel` } : {})}
            onClick={onCancel}
          >
            취소
          </Button>
          <Button
            type="button"
            variant="danger"
            {...(testId !== undefined ? { 'data-testid': `${testId}-ok` } : {})}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {message}
    </Dialog>
  )
}
