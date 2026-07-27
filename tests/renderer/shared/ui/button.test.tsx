// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ThemeProvider, darkTheme } from '@renderer/shared/theme'
import { Button } from '@renderer/shared/ui'

function wrap(ui: React.ReactElement) {
  return render(<ThemeProvider theme={darkTheme}>{ui}</ThemeProvider>)
}

describe('Button', () => {
  it('primary는 강조색으로 채운다', () => {
    wrap(<Button variant="primary">적용</Button>)
    const style = getComputedStyle(screen.getByText('적용'))
    expect(style.backgroundColor).toBe('rgb(10, 132, 255)')
  })

  it('ghost는 배경도 테두리 색도 없다 — 정지 상태의 소음을 없앤다', () => {
    wrap(<Button variant="ghost">새로고침</Button>)
    const style = getComputedStyle(screen.getByText('새로고침'))
    // jsdom의 cssstyle은 background-color: transparent를 rgba(0, 0, 0, 0)로
    // 정규화하지만 border-color는 'transparent' 문자열을 그대로 남긴다.
    expect(style.backgroundColor).toBe('rgba(0, 0, 0, 0)')
    expect(style.borderColor).toBe('transparent')
  })

  it('danger는 채우지 않는다 — 채운 빨강은 습관적 클릭을 부른다', () => {
    wrap(<Button variant="danger">삭제</Button>)
    const style = getComputedStyle(screen.getByText('삭제'))
    expect(style.backgroundColor).toBe('rgba(0, 0, 0, 0)')
    expect(style.borderColor).toBe('rgb(255, 69, 58)')
    expect(style.color).toBe('rgb(255, 69, 58)')
  })
})
