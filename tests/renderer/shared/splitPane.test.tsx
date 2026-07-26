// @vitest-environment jsdom
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ThemeProvider, darkTheme } from '@renderer/shared/theme'
import { SplitPane } from '@renderer/shared/ui/SplitPane'

/**
 * jsdom은 PointerEvent를 구현하지 않는다(https://github.com/jsdom/jsdom/issues/2527).
 * `@testing-library/dom`의 fireEvent.pointerDown/Move/Up은 `window.PointerEvent`가
 * 없으면 일반 Event로 물러나 clientX/clientY가 전부 undefined가 된다 — 드래그
 * 테스트가 실제 좌표를 받도록 최소한의 폴리필을 채워 넣는다.
 */
if (typeof window.PointerEvent === 'undefined') {
  class PointerEventPolyfill extends MouseEvent {
    pointerId: number
    constructor(type: string, params: PointerEventInit = {}) {
      super(type, params)
      this.pointerId = params.pointerId ?? 0
    }
  }
  window.PointerEvent = PointerEventPolyfill as unknown as typeof PointerEvent
}

function renderPane(overrides: Partial<Parameters<typeof SplitPane>[0]> = {}) {
  const onSizeChange = vi.fn()
  render(
    <ThemeProvider theme={darkTheme}>
      <SplitPane
        direction="row"
        anchor="first"
        size={240}
        min={180}
        max={520}
        onSizeChange={onSizeChange}
        label="사이드바 크기"
        testId="split-sidebar"
        first={<div>left</div>}
        second={<div>right</div>}
        {...overrides}
      />
    </ThemeProvider>,
  )
  return { onSizeChange }
}

describe('SplitPane', () => {
  it('양쪽 자식을 모두 그린다', () => {
    renderPane()
    expect(screen.getByText('left')).toBeTruthy()
    expect(screen.getByText('right')).toBeTruthy()
  })

  it('구분자에 접근성 속성을 붙인다', () => {
    renderPane()
    const sep = screen.getByTestId('split-sidebar')
    expect(sep.getAttribute('role')).toBe('separator')
    expect(sep.getAttribute('aria-label')).toBe('사이드바 크기')
    expect(sep.getAttribute('aria-valuenow')).toBe('240')
    expect(sep.getAttribute('aria-valuemin')).toBe('180')
    expect(sep.getAttribute('aria-valuemax')).toBe('520')
  })

  it('화살표 키로 크기를 옮긴다', () => {
    const { onSizeChange } = renderPane()
    const sep = screen.getByTestId('split-sidebar')
    fireEvent.keyDown(sep, { key: 'ArrowRight' })
    expect(onSizeChange).toHaveBeenCalledWith(256)
    fireEvent.keyDown(sep, { key: 'ArrowLeft' })
    expect(onSizeChange).toHaveBeenLastCalledWith(224)
  })

  it('키보드 조작을 최소·최대로 클램프한다', () => {
    const { onSizeChange } = renderPane({ size: 185 })
    const sep = screen.getByTestId('split-sidebar')
    fireEvent.keyDown(sep, { key: 'ArrowLeft' })
    expect(onSizeChange).toHaveBeenCalledWith(180)
  })

  it('anchor가 second면 화살표 방향이 뒤집힌다', () => {
    const { onSizeChange } = renderPane({ anchor: 'second' })
    const sep = screen.getByTestId('split-sidebar')
    fireEvent.keyDown(sep, { key: 'ArrowRight' })
    expect(onSizeChange).toHaveBeenCalledWith(224)
  })

  it('드래그하면 이동한 거리만큼 크기를 올린다', () => {
    const { onSizeChange } = renderPane()
    const sep = screen.getByTestId('split-sidebar')
    fireEvent.pointerDown(sep, { pointerId: 1, clientX: 240, clientY: 0 })
    fireEvent.pointerMove(sep, { pointerId: 1, clientX: 300, clientY: 0 })
    expect(onSizeChange).toHaveBeenLastCalledWith(300)
    fireEvent.pointerUp(sep, { pointerId: 1 })
    fireEvent.pointerMove(sep, { pointerId: 1, clientX: 400, clientY: 0 })
    expect(onSizeChange).toHaveBeenLastCalledWith(300)
  })

  it('collapsed면 고정 쪽 자식과 구분자를 그리지 않는다', () => {
    renderPane({ collapsed: true })
    expect(screen.queryByText('left')).toBeNull()
    expect(screen.queryByTestId('split-sidebar')).toBeNull()
    expect(screen.getByText('right')).toBeTruthy()
  })
})
