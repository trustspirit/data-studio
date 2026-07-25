// @vitest-environment jsdom
import { render, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ThemeProvider, darkTheme } from '@renderer/shared/theme'
import { SqlEditor } from '@renderer/features/query/ui/SqlEditor'

function wrap(node: React.ReactNode) {
  return render(<ThemeProvider theme={darkTheme}>{node}</ThemeProvider>)
}

describe('SqlEditor', () => {
  it('초기 값을 렌더한다', () => {
    // 구문 강조가 토큰별 span으로 쪼개므로 textContent로 확인한다.
    const { container } = wrap(<SqlEditor value="SELECT 1" onChange={() => {}} onRun={() => {}} />)
    const content = container.querySelector('.cm-content')
    expect(content?.textContent).toContain('SELECT 1')
  })

  it('Mod-Enter가 onRun을 부른다', () => {
    const onRun = vi.fn()
    const { container } = wrap(<SqlEditor value="SELECT 1" onChange={() => {}} onRun={onRun} />)
    const content = container.querySelector('.cm-content') as HTMLElement
    // CodeMirror는 keydown을 keymap으로 처리한다.
    fireEvent.keyDown(content, { key: 'Enter', ctrlKey: true })
    expect(onRun).toHaveBeenCalled()
  })
})
