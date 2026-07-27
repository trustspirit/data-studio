import styled from 'styled-components'
import type { DefaultTheme } from 'styled-components'

type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger'

function background(theme: DefaultTheme, tone: Tone): string {
  if (tone === 'neutral') return theme.color.surface.raised
  return theme.color.intentSoft[tone]
}
function foreground(theme: DefaultTheme, tone: Tone): string {
  if (tone === 'neutral') return theme.color.fg.dim
  return theme.color.intent[tone]
}

/**
 * 상태 표시. **채우지 않는다** — 채운 배지는 버튼처럼 보여 클릭을 유도하는데,
 * 배지는 누를 수 있는 것이 아니다.
 */
export const Badge = styled.span<{ tone?: Tone }>`
  display: inline-block;
  font-family: ${({ theme }) => theme.font.ui};
  font-size: ${({ theme }) => theme.fontSize.label};
  font-weight: ${({ theme }) => theme.fontWeight.semibold};
  border-radius: ${({ theme }) => theme.radius.sm};
  padding: 2px 7px;
  background: ${({ theme, tone = 'neutral' }) => background(theme, tone)};
  color: ${({ theme, tone = 'neutral' }) => foreground(theme, tone)};
`
Badge.displayName = 'Badge'
