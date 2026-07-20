// @vitest-environment jsdom
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ThemeProvider, darkTheme } from '@renderer/shared/theme'
import { renderCell } from '@renderer/entities/result-set/renderers'
import type { WireValue } from '@shared/types/wire'

function text(v: WireValue): string {
  const { container } = render(<ThemeProvider theme={darkTheme}>{renderCell(v)}</ThemeProvider>)
  return container.textContent ?? ''
}

describe('renderCell', () => {
  it('null은 NULL로 표시', () => {
    expect(text({ t: 'null' })).toMatch(/NULL/)
  })
  it('bigint/decimal은 문자열 그대로 (정밀도 보존)', () => {
    expect(text({ t: 'bigint', v: '9223372036854775807' })).toContain('9223372036854775807')
    expect(text({ t: 'decimal', v: '0.10' })).toContain('0.10')
  })
  it('bytes는 크기 배지', () => {
    expect(text({ t: 'bytes', v: 'AQID', enc: 'base64', truncated: false })).toMatch(/bytes|base64/i)
  })
  it('bool/int/str/date를 표시', () => {
    expect(text({ t: 'bool', v: true })).toMatch(/true/)
    expect(text({ t: 'int', v: 42 })).toContain('42')
    expect(text({ t: 'str', v: 'hi' })).toContain('hi')
    expect(text({ t: 'date', v: '2020-01-02T03:04:05.000Z' })).toContain('2020-01-02')
  })
  it('json은 값 미리보기', () => {
    expect(text({ t: 'json', v: '{"a":1}', truncated: false })).toContain('{"a":1}')
  })
  it('unknown은 값과 note', () => {
    expect(text({ t: 'unknown', v: 'x', note: 'oid:999' })).toContain('x')
  })
})
