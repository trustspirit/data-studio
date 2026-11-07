// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { fireEvent } from '@testing-library/dom'
import { describe, expect, it, vi } from 'vitest'
import { ThemeProvider, darkTheme } from '@renderer/shared/theme'
import { TabStrip } from '@renderer/shared/ui'

const TABS = [
  { key: 'a', title: 'orders' },
  { key: 'b', title: 'users', dirty: true },
]

function wrap(activeKey: string | null = 'a') {
  const onActivate = vi.fn()
  const onClose = vi.fn()
  render(
    <ThemeProvider theme={darkTheme}>
      <TabStrip tabs={TABS} activeKey={activeKey} onActivate={onActivate} onClose={onClose} label="문서 탭" />
    </ThemeProvider>,
  )
  return { onActivate, onClose }
}

describe('TabStrip', () => {
  it('방향키와 Home으로 탭을 선택하고 포커스를 옮긴다', () => {
    const { onActivate } = wrap()
    fireEvent.keyDown(screen.getByTestId('tab-a'), { key: 'ArrowRight' })
    expect(onActivate).toHaveBeenCalledWith('b')
    expect(document.activeElement).toBe(screen.getByTestId('tab-b'))
    fireEvent.keyDown(screen.getByTestId('tab-b'), { key: 'Home' })
    expect(onActivate).toHaveBeenLastCalledWith('a')
    expect(document.activeElement).toBe(screen.getByTestId('tab-a'))
  })

  it('닫기 버튼이 탭 버튼의 자손이 아니다 — button 안의 button은 HTML·ARIA 위반', () => {
    wrap()
    const tab = screen.getByTestId('tab-a')
    const close = screen.getByTestId('tab-close-a')
    expect(tab.contains(close)).toBe(false)
    expect(close.tagName).toBe('BUTTON')
  })

  it('닫기를 눌러도 탭 활성 요청은 나가지 않는다', () => {
    const { onActivate, onClose } = wrap()
    fireEvent.click(screen.getByTestId('tab-close-b'))
    expect(onClose).toHaveBeenCalledWith('b')
    expect(onActivate).not.toHaveBeenCalled()
  })

  it('탭을 누르면 활성 요청이 나간다', () => {
    const { onActivate } = wrap()
    fireEvent.click(screen.getByTestId('tab-b'))
    expect(onActivate).toHaveBeenCalledWith('b')
  })

  it('미적용 편집이 있는 탭에 표시가 붙는다', () => {
    wrap()
    expect(screen.getByTestId('tab-dirty-b')).toBeTruthy()
    expect(screen.queryByTestId('tab-dirty-a')).toBeNull()
  })

  it('활성 탭만 aria-selected가 true다', () => {
    wrap('a')
    expect(screen.getByTestId('tab-a').getAttribute('aria-selected')).toBe('true')
    expect(screen.getByTestId('tab-b').getAttribute('aria-selected')).toBe('false')
  })

  it('닫기 버튼은 글리프를 잃어도 이름을 유지하고, 아이콘은 장식으로 남는다', () => {
    // 글자를 지우면서 스크린리더가 읽을 것이 사라지는 회귀를 막는다.
    wrap()
    const close = screen.getByTestId('tab-close-a')
    expect(close.getAttribute('aria-label')).toBe('orders 닫기')
    expect(close.textContent).toBe('')
    const svg = close.querySelector('svg')
    expect(svg).not.toBeNull()
    expect(svg?.getAttribute('aria-hidden')).toBe('true')
  })
})
