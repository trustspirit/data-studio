// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ThemeProvider, darkTheme } from '@renderer/shared/theme'
import { Badge } from '@renderer/shared/ui'

function wrap(ui: React.ReactElement) {
  return render(<ThemeProvider theme={darkTheme}>{ui}</ThemeProvider>)
}

describe('Badge', () => {
  it('채우지 않는다 — 채운 배지는 버튼처럼 보여 클릭을 유도한다', () => {
    wrap(<Badge tone="accent">PK1</Badge>)
    const style = getComputedStyle(screen.getByText('PK1'))
    // 불투명 강조색이 아니라 알파 틴트여야 한다.
    expect(style.backgroundColor).toBe('rgba(10, 132, 255, 0.13)')
    expect(style.color).toBe('rgb(10, 132, 255)')
  })

  it('중립 톤은 표면 색을 쓴다', () => {
    wrap(<Badge>int8</Badge>)
    const style = getComputedStyle(screen.getByText('int8'))
    expect(style.backgroundColor).toBe('rgb(47, 47, 58)')
  })

  it('라벨 크기로 렌더한다', () => {
    wrap(<Badge tone="warning">UNIQUE</Badge>)
    expect(getComputedStyle(screen.getByText('UNIQUE')).fontSize).toBe('11px')
  })
})
