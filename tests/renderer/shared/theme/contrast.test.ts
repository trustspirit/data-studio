import { describe, expect, it } from 'vitest'
import { darkTheme } from '@renderer/shared/theme'

/** WCAG 상대 휘도. */
function relative(hex: string): number {
  const channel = (v: number) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  const r = channel(parseInt(hex.slice(1, 3), 16))
  const g = channel(parseInt(hex.slice(3, 5), 16))
  const b = channel(parseInt(hex.slice(5, 7), 16))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
function ratio(fg: string, bg: string): number {
  const a = relative(fg)
  const b = relative(bg)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

describe('대비', () => {
  it('본문 글자가 배경 위에서 4.5:1 이상이다', () => {
    expect(ratio(darkTheme.color.text.primary, darkTheme.color.surface.bg)).toBeGreaterThanOrEqual(4.5)
  })

  it('보조 글자가 배경 위에서 4.5:1 이상이다', () => {
    expect(ratio(darkTheme.color.text.dim, darkTheme.color.surface.bg)).toBeGreaterThanOrEqual(4.5)
  })

  it('SQL 문법 색 8개가 그리드 배경 위에서 4.5:1 이상이다', () => {
    const bg = darkTheme.color.surface.bg
    for (const [name, hex] of Object.entries(darkTheme.syntax)) {
      expect(ratio(hex, bg), `syntax.${name}`).toBeGreaterThanOrEqual(4.5)
    }
  })
})
