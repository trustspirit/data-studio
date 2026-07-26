// @vitest-environment jsdom
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ThemeProvider, darkTheme } from '@renderer/shared/theme'
import { InspectorDock } from '@renderer/features/inspector'

const SECTIONS = [
  { id: 'columns', title: 'Columns', content: <div>컬럼 내용</div> },
  { id: 'ai', title: 'AI', content: <div>대화</div>, grow: true },
]

function renderDock(initiallyOpen?: readonly string[]) {
  render(
    <ThemeProvider theme={darkTheme}>
      <InspectorDock sections={SECTIONS} {...(initiallyOpen !== undefined ? { initiallyOpen } : {})} />
    </ThemeProvider>,
  )
}

describe('InspectorDock', () => {
  it('섹션 제목을 모두 그린다', () => {
    renderDock()
    expect(screen.getByTestId('inspector-section-columns').textContent).toContain('Columns')
    expect(screen.getByTestId('inspector-section-ai').textContent).toContain('AI')
  })

  it('기본으로는 아무 섹션도 펼치지 않는다', () => {
    renderDock()
    expect(screen.queryByTestId('inspector-body-columns')).toBeNull()
  })

  it('initiallyOpen에 든 섹션은 펼친 채로 시작한다', () => {
    renderDock(['columns'])
    expect(screen.getByTestId('inspector-body-columns').textContent).toContain('컬럼 내용')
    expect(screen.queryByTestId('inspector-body-ai')).toBeNull()
  })

  it('헤더를 누르면 펼치고 다시 누르면 접는다', () => {
    renderDock()
    fireEvent.click(screen.getByTestId('inspector-section-columns'))
    expect(screen.getByTestId('inspector-body-columns')).toBeTruthy()
    fireEvent.click(screen.getByTestId('inspector-section-columns'))
    expect(screen.queryByTestId('inspector-body-columns')).toBeNull()
  })

  it('여러 섹션을 동시에 펼칠 수 있다', () => {
    renderDock()
    fireEvent.click(screen.getByTestId('inspector-section-columns'))
    fireEvent.click(screen.getByTestId('inspector-section-ai'))
    expect(screen.getByTestId('inspector-body-columns')).toBeTruthy()
    expect(screen.getByTestId('inspector-body-ai')).toBeTruthy()
  })

  it('펼침 상태를 aria-expanded로 알린다', () => {
    renderDock(['ai'])
    expect(screen.getByTestId('inspector-section-ai').getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByTestId('inspector-section-columns').getAttribute('aria-expanded')).toBe('false')
  })

  it('grow 섹션은 접혀 있을 때는 남은 높이를 차지하지 않고, 펼쳤을 때만 차지한다', () => {
    renderDock()
    const section = screen.getByTestId('inspector-section-ai').parentElement as HTMLElement
    expect(getComputedStyle(section).flexGrow).not.toBe('1')
    fireEvent.click(screen.getByTestId('inspector-section-ai'))
    expect(getComputedStyle(section).flexGrow).toBe('1')
  })
})
