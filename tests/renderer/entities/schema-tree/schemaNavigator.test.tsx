// @vitest-environment jsdom
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ThemeProvider, darkTheme } from '@renderer/shared/theme'
import { SchemaNavigator } from '@renderer/entities/schema-tree'

function table(schema: string, name: string) {
  return { schema, name, kind: 'table' as const, estimatedRows: null }
}
function wrap(ui: React.ReactElement) {
  return render(<ThemeProvider theme={darkTheme}>{ui}</ThemeProvider>)
}

describe('SchemaNavigator', () => {
  it('스키마 이름들을 렌더한다', () => {
    wrap(
      <SchemaNavigator
        schemas={[{ name: 'public' }, { name: 'sales' }]}
        tablesBySchema={{}}
        expanded={{}}
        selected={null}
        onToggle={vi.fn()}
        onSelect={vi.fn()}
      />,
    )
    expect(screen.getByText(/public/)).toBeTruthy()
    expect(screen.getByText(/sales/)).toBeTruthy()
  })

  it('스키마를 클릭하면 onToggle을 부른다', () => {
    const onToggle = vi.fn()
    wrap(
      <SchemaNavigator
        schemas={[{ name: 'public' }]}
        tablesBySchema={{}}
        expanded={{}}
        selected={null}
        onToggle={onToggle}
        onSelect={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByText(/public/))
    expect(onToggle).toHaveBeenCalledWith('public')
  })

  it('펼쳐진 스키마의 테이블만 렌더한다', () => {
    // 접힌 스키마의 테이블을 렌더하면 트리가 항상 펼쳐진 것과 구분되지 않는다.
    wrap(
      <SchemaNavigator
        schemas={[{ name: 'public' }, { name: 'sales' }]}
        tablesBySchema={{ public: [table('public', 'users')], sales: [table('sales', 'orders')] }}
        expanded={{ public: true, sales: false }}
        selected={null}
        onToggle={vi.fn()}
        onSelect={vi.fn()}
      />,
    )
    expect(screen.getByText('users')).toBeTruthy()
    expect(screen.queryByText('orders')).toBeNull()
  })

  it('테이블을 클릭하면 onSelect에 schema/table을 준다', () => {
    const onSelect = vi.fn()
    wrap(
      <SchemaNavigator
        schemas={[{ name: 'public' }]}
        tablesBySchema={{ public: [table('public', 'users')] }}
        expanded={{ public: true }}
        selected={null}
        onToggle={vi.fn()}
        onSelect={onSelect}
      />,
    )
    fireEvent.click(screen.getByText('users'))
    expect(onSelect).toHaveBeenCalledWith({ schema: 'public', table: 'users' })
  })

  it('중첩 렌더에서는 자기 폭·보더를 갖지 않고 depth만큼 들여쓴다', () => {
    const props = {
      schemas: [{ name: 'public' }],
      tablesBySchema: { public: [table('public', 'users')] },
      expanded: { public: true },
      selected: null,
      onToggle: vi.fn(),
      onSelect: vi.fn(),
    }
    const top = render(
      <ThemeProvider theme={darkTheme}>
        <SchemaNavigator {...props} />
      </ThemeProvider>,
    )
    const topTree = top.container.firstElementChild as HTMLElement
    const topSchemaPad = getComputedStyle(screen.getByText(/public/)).paddingLeft
    expect(getComputedStyle(topTree).borderRightWidth).toBe('1px')
    top.unmount()

    const nested = render(
      <ThemeProvider theme={darkTheme}>
        <SchemaNavigator {...props} inline depth={1} />
      </ThemeProvider>,
    )
    const nestedTree = nested.container.firstElementChild as HTMLElement
    // 바깥 사이드바가 이미 폭과 보더를 갖고 있다 — 안쪽 트리가 또 그으면 안 된다.
    expect(getComputedStyle(nestedTree).borderRightWidth).not.toBe('1px')
    expect(getComputedStyle(nestedTree).width).toBe('')
    // 한 단계 더 들어갔으니 스키마 행이 더 들여써진다.
    expect(getComputedStyle(screen.getByText(/public/)).paddingLeft).not.toBe(topSchemaPad)
  })
})
