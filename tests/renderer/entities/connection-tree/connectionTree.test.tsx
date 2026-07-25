// @vitest-environment jsdom
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ThemeProvider, darkTheme } from '@renderer/shared/theme'
import { ConnectionRow, ConnectionTree, type ConnectionRowState } from '@renderer/entities/connection-tree'

function wrap(ui: React.ReactElement) {
  return render(<ThemeProvider theme={darkTheme}>{ui}</ThemeProvider>)
}

interface RowOverrides {
  state?: ConnectionRowState
  expanded?: boolean
  active?: boolean
  error?: string | null
  children?: React.ReactNode
}
const noop = () => {}
function row(handlers: Partial<Record<'onToggle' | 'onRowClick' | 'onConnect' | 'onClose' | 'onSettings', () => void>> = {}, over: RowOverrides = {}) {
  return (
    <ConnectionRow
      id="a"
      name="prod"
      engine="postgres"
      state={over.state ?? 'closed'}
      expanded={over.expanded ?? false}
      active={over.active ?? false}
      error={over.error ?? null}
      onToggle={handlers.onToggle ?? noop}
      onRowClick={handlers.onRowClick ?? noop}
      onConnect={handlers.onConnect ?? noop}
      onClose={handlers.onClose ?? noop}
      onSettings={handlers.onSettings ?? noop}
    >
      {over.children}
    </ConnectionRow>
  )
}

describe('ConnectionTree', () => {
  it('연결이 없으면 추가 안내를 보여 준다', () => {
    wrap(<ConnectionTree isEmpty onNew={noop} />)
    expect(screen.getByText(/\+로 추가하세요/)).toBeTruthy()
  })

  it('+ 버튼이 onNew를 부른다', () => {
    const onNew = vi.fn()
    wrap(<ConnectionTree isEmpty onNew={onNew} />)
    fireEvent.click(screen.getByRole('button', { name: '새 연결' }))
    expect(onNew).toHaveBeenCalledOnce()
  })

  it('연결이 있으면 안내 대신 행을 보여 준다', () => {
    wrap(<ConnectionTree isEmpty={false} onNew={noop}>{row()}</ConnectionTree>)
    expect(screen.queryByText(/\+로 추가하세요/)).toBeNull()
    expect(screen.getByTestId('conn-a')).toBeTruthy()
  })
})

describe('ConnectionRow', () => {
  it('셰브런과 행 본문이 서로 다른 콜백을 부른다', () => {
    const onToggle = vi.fn()
    const onRowClick = vi.fn()
    wrap(row({ onToggle, onRowClick }))
    fireEvent.click(screen.getByTestId('chevron-a'))
    expect(onToggle).toHaveBeenCalledOnce()
    expect(onRowClick).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('conn-a'))
    expect(onRowClick).toHaveBeenCalledOnce()
    expect(onToggle).toHaveBeenCalledOnce()
  })

  it('닫힌 연결은 연결 버튼을, 열린 연결은 닫기 버튼을 갖는다', () => {
    const { unmount } = wrap(row({}, { state: 'closed' }))
    expect(screen.getByTestId('connect-a')).toBeTruthy()
    expect(screen.queryByTestId('close-a')).toBeNull()
    unmount()

    wrap(row({}, { state: 'ready' }))
    expect(screen.getByTestId('close-a')).toBeTruthy()
    expect(screen.queryByTestId('connect-a')).toBeNull()
  })

  it('여는 중에는 닫기를 누를 수 없다', () => {
    wrap(row({}, { state: 'connecting' }))
    expect(screen.getByTestId<HTMLButtonElement>('close-a').disabled).toBe(true)
  })

  it('실패한 연결은 사유를 행 아래에 보여 주고 버튼이 재시도가 된다', () => {
    wrap(row({}, { state: 'error', error: 'password required' }))
    expect(screen.getByTestId('row-error-a').textContent).toBe('password required')
    expect(screen.getByTestId('connect-a').textContent).toBe('재시도')
  })

  it('펼쳤을 때만 하위 트리를 렌더한다', () => {
    const { unmount } = wrap(row({}, { expanded: false, children: <div>public</div> }))
    expect(screen.queryByText('public')).toBeNull()
    unmount()

    wrap(row({}, { expanded: true, children: <div>public</div> }))
    expect(screen.getByText('public')).toBeTruthy()
  })

  it('설정 버튼이 onSettings를 부른다', () => {
    const onSettings = vi.fn()
    wrap(row({ onSettings }))
    fireEvent.click(screen.getByRole('button', { name: 'prod 설정' }))
    expect(onSettings).toHaveBeenCalledOnce()
  })
})
