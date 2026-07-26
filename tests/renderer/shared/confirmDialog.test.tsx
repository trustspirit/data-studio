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

  // document.body에서 쏜다. body는 React 루트 컨테이너의 **조상**이라 React가
  // 붙이는 어떤 핸들러도 여기서는 불릴 수 없다 — 이 단언을 만족시킬 수 있는
  // 것은 컴포넌트가 document에 직접 건 리스너뿐이다. 다이얼로그 안(Backdrop이나
  // 포커스된 취소 버튼)에서 쏘면 Backdrop에 건 onKeyDown으로도 통과해 버려서,
  // 리스너 위치가 퇴행해도 테스트가 초록으로 남는다.
  it('다이얼로그 밖에서 눌린 Escape로도 취소된다', () => {
    const { onCancel } = renderDialog()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalled()
  })
})
