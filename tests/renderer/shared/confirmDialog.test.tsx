// @vitest-environment jsdom
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ThemeProvider, darkTheme } from '@renderer/shared/theme'
import { ConfirmDialog } from '@renderer/shared/ui'

function renderDialog() {
  const onConfirm = vi.fn()
  const onCancel = vi.fn()
  render(
    <ThemeProvider theme={darkTheme}>
      <ConfirmDialog
        title="편집을 버릴까요?"
        message="적용하지 않은 변경이 있습니다."
        confirmLabel="버리고 닫기"
        onConfirm={onConfirm}
        onCancel={onCancel}
        testId="confirm-close"
      />
    </ThemeProvider>,
  )
  return { onConfirm, onCancel }
}

describe('ConfirmDialog', () => {
  it('제목과 메시지를 보여 준다', () => {
    renderDialog()
    expect(screen.getByTestId('confirm-close').textContent).toContain('적용하지 않은 변경이 있습니다.')
  })

  it('확인을 누르면 onConfirm이 불린다', () => {
    const { onConfirm } = renderDialog()
    fireEvent.click(screen.getByTestId('confirm-close-ok'))
    expect(onConfirm).toHaveBeenCalled()
  })

  it('취소를 누르면 onCancel이 불린다', () => {
    const { onCancel } = renderDialog()
    fireEvent.click(screen.getByTestId('confirm-close-cancel'))
    expect(onCancel).toHaveBeenCalled()
  })

  it('Escape로 취소된다', () => {
    const { onCancel } = renderDialog()
    fireEvent.keyDown(screen.getByTestId('confirm-close'), { key: 'Escape' })
    expect(onCancel).toHaveBeenCalled()
  })
})
