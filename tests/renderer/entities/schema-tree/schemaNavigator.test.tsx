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
})
