// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ThemeProvider, darkTheme } from '@renderer/shared/theme'
import { SqlCode } from '@renderer/entities/sql-lang'

function renderCode(code: string) {
  return render(
    <ThemeProvider theme={darkTheme}>
      <SqlCode engine="postgres" code={code} data-testid="code" />
    </ThemeProvider>,
  )
}

describe('SqlCode', () => {
  it('토큰마다 클래스를 붙여 그린다', () => {
    renderCode(`CREATE TABLE "t" ("id" bigint DEFAULT 'x')`)
    const host = screen.getByTestId('code')
    const classOf = (text: string) =>
      [...host.querySelectorAll('span')].find((s) => s.textContent === text)?.className ?? ''

    expect(classOf('CREATE')).toContain('tok-keyword')
    expect(classOf('bigint')).toContain('tok-type')
    expect(classOf("'x'")).toContain('tok-string')
    // 인용 식별자는 문자열과 다른 토큰이다.
    expect(classOf('"id"')).toContain('tok-ident')
  })

  it('원문을 글자 그대로 보존한다', () => {
    // 토큰으로 쪼갠 뒤 다시 이어 붙였을 때 원문과 같아야 한다. 한 글자라도
    // 빠지면 사용자가 실행할 SQL과 화면에 보이는 SQL이 달라진다.
    const code = 'CREATE TABLE "t" (\n  "id" bigint,\n  PRIMARY KEY ("id")\n)'
    renderCode(code)
    expect(screen.getByTestId('code').textContent).toBe(code)
  })

  it('빈 문자열도 던지지 않는다', () => {
    expect(() => renderCode('')).not.toThrow()
  })
})
