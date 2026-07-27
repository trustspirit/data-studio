// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { fireEvent } from '@testing-library/dom'
import { describe, expect, it, vi } from 'vitest'
import { ThemeProvider, darkTheme } from '@renderer/shared/theme'
import { SegmentedGroup, type SegmentItem } from '@renderer/shared/ui'

function wrap(items: readonly SegmentItem[]) {
  return render(
    <ThemeProvider theme={darkTheme}>
      <SegmentedGroup items={items} label="테이블 액션" testId="seg" />
    </ThemeProvider>,
  )
}
const noop = () => {}

describe('SegmentedGroup', () => {
  it('미지원 항목을 숨기지 않고 비활성으로 남긴다 — 폭이 고정되고 못 하는 일이 보인다', () => {
    const fk = vi.fn()
    wrap([
      { id: 'refresh', label: '새로고침', onSelect: noop },
      { id: 'fk', label: 'FK', onSelect: fk, disabled: true },
    ])
    const button = screen.getByText('FK')
    expect(button).toBeTruthy()
    expect(button.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(button)
    expect(fk).not.toHaveBeenCalled()
  })

  it('활성 항목을 누르면 핸들러가 불린다', () => {
    const refresh = vi.fn()
    wrap([{ id: 'refresh', label: '새로고침', onSelect: refresh }])
    fireEvent.click(screen.getByText('새로고침'))
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('그룹에 접근성 이름이 붙는다', () => {
    wrap([{ id: 'a', label: 'A', onSelect: noop }])
    expect(screen.getByRole('group', { name: '테이블 액션' })).toBeTruthy()
  })

  it('항목이 모두 진짜 button이다 — div에 클릭 핸들러를 달지 않는다', () => {
    wrap([
      { id: 'a', label: 'A', onSelect: noop },
      { id: 'b', label: 'B', onSelect: noop, disabled: true },
    ])
    expect(screen.getByText('A').tagName).toBe('BUTTON')
    expect(screen.getByText('B').tagName).toBe('BUTTON')
  })
})
