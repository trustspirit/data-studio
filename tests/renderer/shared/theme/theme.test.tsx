// @vitest-environment jsdom
import { render } from '@testing-library/react'
import styled from 'styled-components'
import { describe, expect, it } from 'vitest'
import { darkTheme, ThemeProvider } from '@renderer/shared/theme'

describe('darkTheme', () => {
  it('스펙의 핵심 토큰 값을 담는다', () => {
    // 이 값들이 틀리면 디자인 시스템 전체가 어긋난다.
    expect(darkTheme.color.surface.bg).toBe('#101014')
    expect(darkTheme.color.surface.base).toBe('#191920')
    expect(darkTheme.color.surface.panel).toBe('#23232c')
    expect(darkTheme.color.surface.raised).toBe('#2f2f3a')
    expect(darkTheme.fontSize.label).toBe('14px')
    expect(darkTheme.fontSize.body).toBe('16px')
    expect(darkTheme.fontSize.heading).toBe('24px')
    expect(darkTheme.fontSize.title).toBe('32px')
    expect(darkTheme.color.intent.accent).toBe('#0a84ff')
    expect(darkTheme.syntax.keyword).toBe('#ff7ab2')
    expect(darkTheme.density.rowPad).toBe('8px 14px')
    expect(darkTheme.density.rowHeight).toBe('36px')
    expect(darkTheme.density.controlHeight).toBe('44px')
    expect(darkTheme.density.controlHeightSm).toBe('32px')
    expect(darkTheme.density.controlPad).toBe('0 16px')
  })

  it('ThemeProvider가 styled 컴포넌트에 토큰을 주입한다', () => {
    const Box = styled.div`
      color: ${({ theme }) => theme.color.intent.accent};
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
