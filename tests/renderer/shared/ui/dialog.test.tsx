// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { fireEvent } from '@testing-library/dom'
import { describe, expect, it, vi } from 'vitest'
import { ThemeProvider, darkTheme } from '@renderer/shared/theme'
import { Dialog, Button } from '@renderer/shared/ui'

function wrap(onClose: () => void, dismissOnBackdrop?: boolean) {
  return render(
    <ThemeProvider theme={darkTheme}>
      <Dialog
        title="적용하지 않은 편집이 있습니다"
        onClose={onClose}
        testId="dlg"
        {...(dismissOnBackdrop !== undefined ? { dismissOnBackdrop } : {})}
        footer={<Button variant="ghost">취소</Button>}
      >
        <p>본문</p>
      </Dialog>
    </ThemeProvider>,
  )
}

describe('Dialog', () => {
  it('document.body에서 발생한 Escape로 닫힌다', () => {
    const onClose = vi.fn()
    wrap(onClose)
    // 다이얼로그 내부가 아니라 React 루트 **바깥**에서 쏜다. 내부에서 쏘면
    // document 리스너와 컴포넌트 핸들러를 구별할 수 없다.
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('언마운트되면 Escape를 더 듣지 않는다', () => {
    const onClose = vi.fn()
    const { unmount } = wrap(onClose)
    unmount()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('배경 클릭으로 닫힌다', () => {
    const onClose = vi.fn()
    wrap(onClose)
    fireEvent.click(screen.getByTestId('dlg'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('dismissOnBackdrop=false면 배경 클릭으로 닫히지 않는다', () => {
    const onClose = vi.fn()
    wrap(onClose, false)
    fireEvent.click(screen.getByTestId('dlg'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('내용 클릭은 닫지 않는다', () => {
    const onClose = vi.fn()
    wrap(onClose)
    fireEvent.click(screen.getByText('본문'))
    expect(onClose).not.toHaveBeenCalled()
  })
})
