// @vitest-environment jsdom
import { render } from '@testing-library/react'
import styled from 'styled-components'
import { describe, expect, it } from 'vitest'
import { darkTheme, ThemeProvider } from '@renderer/shared/theme'

describe('darkTheme', () => {
  it('스펙의 핵심 토큰 값을 담는다', () => {
    // 이 값들이 틀리면 디자인 시스템 전체가 어긋난다.
    expect(darkTheme.color.accent).toBe('#0a84ff')
    expect(darkTheme.color.winBg).toBe('#1a1a1e')
    expect(darkTheme.color.red).toBe('#ff453a')
    expect(darkTheme.syntax.keyword).toBe('#ff7ab2')
    expect(darkTheme.density.rowPad).toBe('4px 12px')
  })

  it('ThemeProvider가 styled 컴포넌트에 토큰을 주입한다', () => {
    const Box = styled.div`
      color: ${({ theme }) => theme.color.accent};
    `
    const { container } = render(
      <ThemeProvider theme={darkTheme}>
        <Box>hi</Box>
      </ThemeProvider>,
    )
    const el = container.querySelector('div')
    expect(el).not.toBeNull()
    // 주입이 끊기면 color가 비어 이 단언이 깨진다.
    expect(getComputedStyle(el as Element).color).toBe('rgb(10, 132, 255)')
  })
})
