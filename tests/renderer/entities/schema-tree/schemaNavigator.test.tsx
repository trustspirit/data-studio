// @vitest-environment jsdom
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ThemeProvider, darkTheme } from '@renderer/shared/theme'
import { SchemaNavigator } from '@renderer/entities/schema-tree'
import type { TableSelection } from '@renderer/entities/schema-tree'

function table(schema: string, name: string) {
  return { schema, name, kind: 'table' as const, estimatedRows: null }
}
function wrap(ui: React.ReactElement) {
  return render(<ThemeProvider theme={darkTheme}>{ui}</ThemeProvider>)
}

interface NavigatorOverrides {
  onSelect?: (selection: TableSelection) => void
  onOpen?: (selection: TableSelection) => void
  onOpenSchema?: (schema: string) => void
  onToggle?: (schema: string) => void
}

/** public 스키마가 펼쳐진 채 orders 테이블이 보이는 기본 트리. */
function renderNavigator(overrides: NavigatorOverrides = {}) {
  const {
    onSelect = vi.fn(),
    onOpen = vi.fn(),
    onOpenSchema,
    onToggle = vi.fn(),
  } = overrides
  return wrap(
    <SchemaNavigator
      schemas={[{ name: 'public' }]}
      tablesBySchema={{ public: [table('public', 'orders')] }}
      expanded={{ public: true }}
      selected={null}
      onToggle={onToggle}
      onSelect={onSelect}
      onOpen={onOpen}
      {...(onOpenSchema !== undefined ? { onOpenSchema } : {})}
    />,
  )
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
        onOpen={vi.fn()}
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
        onOpen={vi.fn()}
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
        onOpen={vi.fn()}
      />,
    )
    expect(screen.getByText('users')).toBeTruthy()
    expect(screen.queryByText('orders')).toBeNull()
  })

  it('테이블 한 번 클릭은 선택만 한다 — 스치는 클릭이 SELECT를 쏘면 안 된다', () => {
    const onSelect = vi.fn()
    const onOpen = vi.fn()
    renderNavigator({ onSelect, onOpen })
    fireEvent.click(screen.getByText('orders'))
    expect(onSelect).toHaveBeenCalledWith({ schema: 'public', table: 'orders' })
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('테이블을 두 번 클릭하면 연다', () => {
    const onOpen = vi.fn()
    renderNavigator({ onOpen })
    fireEvent.doubleClick(screen.getByText('orders'))
    expect(onOpen).toHaveBeenCalledWith({ schema: 'public', table: 'orders' })
  })

  it('테이블에서 Enter를 눌러도 연다', () => {
    const onOpen = vi.fn()
    renderNavigator({ onOpen })
    fireEvent.keyDown(screen.getByText('orders'), { key: 'Enter' })
    expect(onOpen).toHaveBeenCalledWith({ schema: 'public', table: 'orders' })
  })

  it('Enter가 아닌 키는 열지 않는다', () => {
    const onOpen = vi.fn()
    renderNavigator({ onOpen })
    fireEvent.keyDown(screen.getByText('orders'), { key: 'a' })
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('스키마 행에서 ER 열기를 제공한다', () => {
    const onOpenSchema = vi.fn()
    renderNavigator({ onOpenSchema })
    fireEvent.click(screen.getByTestId('schema-open-er-public'))
    expect(onOpenSchema).toHaveBeenCalledWith('public')
  })

  it('ER 열기는 키보드로 닿고 키보드로 눌린다', () => {
    // 네이티브 <button>만이 탭 순서에 들어가고 Enter/Space를 click으로 바꾼다.
    // span[role=button]으로 두면 키보드 사용자에게는 ER을 여는 길이 아예 없다.
    const onOpenSchema = vi.fn()
    renderNavigator({ onOpenSchema })
    const er = screen.getByTestId('schema-open-er-public')

    expect(er.tagName).toBe('BUTTON')
    er.focus()
    expect(document.activeElement).toBe(er)
    fireEvent.click(er)
    expect(onOpenSchema).toHaveBeenCalledWith('public')
  })

  it('ER 열기는 다른 버튼 안에 들어 있지 않다', () => {
    // 버튼 안의 버튼은 보조 기술이 하나로 합쳐 버린다 — 연결 행이 액션을
    // 라벨의 형제로 두는 것과 같은 이유다.
    const onOpenSchema = vi.fn()
    renderNavigator({ onOpenSchema })
    const er = screen.getByTestId('schema-open-er-public')
    expect(er.parentElement?.closest('button')).toBeNull()
  })

  it('ER 열기는 스키마 접기/펼치기를 겸하지 않는다', () => {
    // 스키마 행 클릭은 펼치기다 — ER 버튼이 그 위로 버블링하면 트리가 접힌다.
    const onToggle = vi.fn()
    const onOpenSchema = vi.fn()
    renderNavigator({ onToggle, onOpenSchema })
    fireEvent.click(screen.getByTestId('schema-open-er-public'))
    expect(onOpenSchema).toHaveBeenCalledWith('public')
    expect(onToggle).not.toHaveBeenCalled()
  })

  it('onOpenSchema가 없으면 ER 버튼이 나오지 않는다', () => {
    renderNavigator()
    expect(screen.queryByTestId('schema-open-er-public')).toBeNull()
  })

  it('중첩 렌더에서는 자기 폭·보더를 갖지 않고 depth만큼 들여쓴다', () => {
    const props = {
      schemas: [{ name: 'public' }],
      tablesBySchema: { public: [table('public', 'users')] },
      expanded: { public: true },
      selected: null,
      onToggle: vi.fn(),
      onSelect: vi.fn(),
      onOpen: vi.fn(),
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
