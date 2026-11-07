// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ThemeProvider, darkTheme } from '@renderer/shared/theme'
import { AppErrorBoundary } from '@renderer/app/AppErrorBoundary'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('렌더 실패에 복구 안내를 표시하고 재시도한다', () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  let failed = true
  function Child() {
    if (failed) throw new Error('render failed')
    return <p>복구됨</p>
  }
  render(<ThemeProvider theme={darkTheme}><AppErrorBoundary><Child /></AppErrorBoundary></ThemeProvider>)
  expect(screen.getByRole('alert').textContent).toContain('작업 화면을 불러오지 못했습니다')
  failed = false
  fireEvent.click(screen.getByText('다시 시도'))
  expect(screen.getByText('복구됨')).toBeTruthy()
})
