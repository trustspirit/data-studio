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

  // 파괴적 확인 다이얼로그는 배경 클릭으로 닫히지 않아야 한다 — 스친 클릭이
  // 취소로 읽히면 사용자는 자기가 무엇을 했는지 모른다. Dialog 자체의
  // dismissOnBackdrop 메커니즘은 dialog.test.tsx가 이미 검증하지만, 그
  // 테스트는 프로퍼티를 직접 넘겨 메커니즘만 증명할 뿐 ConfirmDialog가
  // 실제로 그 프로퍼티를 넘기는지는 증명하지 않는다. 여기서 그걸 고정한다.
  it('배경을 클릭해도 닫히지 않는다', () => {
    const { onCancel } = renderDialog()
    fireEvent.click(screen.getByTestId('confirm-close'))
    expect(onCancel).not.toHaveBeenCalled()
  })

  // 마운트 시 포커스는 취소 버튼에 있어야 한다 — 파괴적 동작(확인 버튼)에
  // 자동 포커스가 가면 엔터 한 번으로 의도치 않게 삭제/버리기가 실행될 수
  // 있다. initialFocusRef가 취소 버튼을 계속 가리키는지 여기서 고정한다.
  it('마운트 시 포커스가 취소 버튼에 있다', () => {
    renderDialog()
    expect(document.activeElement).toBe(screen.getByTestId('confirm-close-cancel'))
  })
})
