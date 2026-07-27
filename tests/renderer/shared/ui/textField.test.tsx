// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ThemeProvider, darkTheme } from '@renderer/shared/theme'
import { TextField } from '@renderer/shared/ui'

function wrap(error?: string) {
  return render(
    <ThemeProvider theme={darkTheme}>
      <TextField
        label="호스트"
        value="db.internal"
        onValueChange={() => {}}
        {...(error !== undefined ? { error } : {})}
      />
    </ThemeProvider>,
  )
}

describe('TextField', () => {
  it('기본 상태에 테두리 색이 없다 — 폼에 입력이 여럿일 때 테두리가 소음이 된다', () => {
    wrap()
    const style = getComputedStyle(screen.getByLabelText('호스트'))
    expect(style.borderColor).toBe('transparent')
    expect(style.backgroundColor).toBe('rgb(25, 25, 32)')
  })

  it('오류일 때만 테두리가 danger로 바뀐다', () => {
    wrap('필수 항목입니다')
    expect(getComputedStyle(screen.getByLabelText('호스트')).borderColor).toBe('rgb(255, 69, 58)')
    expect(screen.getByText('필수 항목입니다')).toBeTruthy()
  })

  it('라벨 캡션은 label 크기다', () => {
    wrap()
    expect(getComputedStyle(screen.getByText('호스트')).fontSize).toBe('11px')
  })

  it('포커스에서만 테두리가 accent로 나타난다 — 채움형 필드의 유일한 입력 피드백이다', () => {
    wrap()
    const field = screen.getByLabelText('호스트')
    field.focus()
    expect(document.activeElement).toBe(field)
    expect(getComputedStyle(field).borderColor).toBe('rgb(10, 132, 255)')
  })
})
