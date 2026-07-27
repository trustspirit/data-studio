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

  it('비활성 primary는 강조색 채움을 잃는다 — 읽을 수 없는 라벨을 남기지 않는다', () => {
    wrap(
      <Button variant="primary" disabled>
        저장
      </Button>,
    )
    const style = getComputedStyle(screen.getByText('저장'))
    expect(style.backgroundColor).not.toBe('rgb(10, 132, 255)') // intent.accent
    expect(style.backgroundColor).toBe('rgb(25, 25, 32)') // surface.base
    expect(style.color).toBe('rgb(74, 74, 86)') // text.disabled
  })

  it('비활성 ghost는 판과 테두리를 얻는다 — 빈 공간과 구별되어야 한다', () => {
    // 툴바의 되돌리기·저장은 편집 전 기본값이 비활성이다. 배경도 테두리도 없으면
    // 사용자는 버튼이 있다는 사실 자체를 알 수 없다.
    wrap(
      <Button variant="ghost" disabled>
        되돌리기
      </Button>,
    )
    const style = getComputedStyle(screen.getByText('되돌리기'))
    expect(style.backgroundColor).toBe('rgb(25, 25, 32)') // surface.base
    expect(style.borderColor).toBe('rgb(42, 42, 52)') // border.soft
  })

  it('danger는 채우지 않는다 — 채운 빨강은 습관적 클릭을 부른다', () => {
    wrap(<Button variant="danger">삭제</Button>)
    const style = getComputedStyle(screen.getByText('삭제'))
    expect(style.backgroundColor).toBe('rgba(0, 0, 0, 0)')
    expect(style.borderColor).toBe('rgb(255, 69, 58)')
    expect(style.color).toBe('rgb(255, 69, 58)')
  })
})
