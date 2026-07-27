// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ThemeProvider, darkTheme } from '@renderer/shared/theme'
import { renderCell } from '@renderer/entities/result-set/renderers'
import type { WireValue } from '@shared/types/wire'

function text(v: WireValue): string {
  const { container } = render(<ThemeProvider theme={darkTheme}>{renderCell(v)}</ThemeProvider>)
  return container.textContent ?? ''
}

function wrap(node: React.ReactNode) {
  return render(<ThemeProvider theme={darkTheme}>{node}</ThemeProvider>)
}

describe('renderCell', () => {
  it('null은 NULL 글자로 렌더한다 — 빈 문자열과 구별되어야 한다', () => {
    wrap(renderCell({ t: 'null' }))
    const el = screen.getByText('NULL')
    const style = getComputedStyle(el)
    expect(style.fontStyle).toBe('italic')
    // NULL은 데이터다 — 비활성 컨트롤이 아니라서 WCAG 면제가 적용되지 않는다.
    // text.disabled(2.17:1)로 내려가면 읽을 수 없다.
    expect(style.color).toBe('rgb(110, 110, 124)') // text.faint
    expect(style.color).not.toBe('rgb(74, 74, 86)') // text.disabled
  })

  it('빈 문자열은 NULL로 렌더하지 않는다', () => {
    const { container } = wrap(renderCell({ t: 'str', v: '' }))
    expect(container.textContent).toBe('')
    // textContent === ''는 str 렌더러 삭제와 fallback('' 반환)이 우연히 같은 결과를 내
    // 무의미해질 수 있다 — NULL 글자가 없다는 것까지 확인해야 빈 문자열과 NULL의
    // 구별(DB 의미론의 핵심)을 실제로 검증한다.
    expect(screen.queryByText('NULL')).toBeNull()
  })

  it('숫자는 등폭으로 렌더한다 — 자릿수가 세로로 맞아야 크기 차이가 보인다', () => {
    // WireValue의 int는 v: number다(brief 예시의 v: '42000'은 타입 오류라 여기선 42000으로 교정).
    wrap(renderCell({ t: 'int', v: 42000 }))
    expect(getComputedStyle(screen.getByText('42000')).fontFamily).toContain('monospace')
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
