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
    wrap(row({ onToggle, onRowClick }, { state: 'ready' }))
    fireEvent.click(screen.getByTestId('chevron-a'))
    expect(onToggle).toHaveBeenCalledOnce()
    expect(onRowClick).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('conn-a'))
    expect(onRowClick).toHaveBeenCalledOnce()
    expect(onToggle).toHaveBeenCalledOnce()
  })

  it('접속되지 않은 행에는 셰브런이 없다', () => {
    // 닫힌 연결에는 읽어 올 스키마가 없다. 셰브런을 주면 눌러도 빈 것이 열려
    // 막다른 길이 된다.
    for (const state of ['closed', 'connecting', 'error'] as const) {
      const { unmount } = wrap(row({}, { state }))
      expect(screen.queryByTestId('chevron-a')).toBeNull()
      unmount()
    }
    wrap(row({}, { state: 'ready' }))
    expect(screen.getByTestId('chevron-a')).toBeTruthy()
  })

  it('닫힌 연결은 연결 버튼을, 열린 연결은 메뉴 안의 연결 끊기를 갖는다', () => {
    const { unmount } = wrap(row({}, { state: 'closed' }))
    expect(screen.getByTestId('connect-a')).toBeTruthy()
    fireEvent.click(screen.getByTestId('more-a'))
    expect(screen.queryByTestId('close-a')).toBeNull()
    unmount()

    wrap(row({}, { state: 'ready' }))
    expect(screen.queryByTestId('connect-a')).toBeNull()
    fireEvent.click(screen.getByTestId('more-a'))
    expect(screen.getByTestId('close-a')).toBeTruthy()
  })

  it('여는 중에는 연결 끊기를 누를 수 없다', () => {
    wrap(row({}, { state: 'connecting' }))
    fireEvent.click(screen.getByTestId('more-a'))
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

  it('활성 행이 사이드바 표면과 다른 배경을 갖는다 — 지금 무엇을 보는지 알 수 있어야 한다', () => {
    // 이름은 활성 여부와 무관하게 늘 text.primary라 글자로는 단서가 없다.
    // 배경이 유일한 신호이므로 사이드바(surface.base)와 같아지면 표시가 사라진다.
    const { unmount } = wrap(row({}, { active: true }))
    const activeBg = getComputedStyle(screen.getByTestId('conn-a').parentElement as HTMLElement)
      .backgroundColor
    unmount()

    wrap(row({}, { active: false }))
    const idleBg = getComputedStyle(screen.getByTestId('conn-a').parentElement as HTMLElement)
      .backgroundColor

    expect(activeBg).not.toBe(idleBg)
    expect(activeBg).not.toBe('rgb(25, 25, 32)') // darkTheme.color.surface.base
    expect(activeBg).toBe('rgba(10, 132, 255, 0.16)') // darkTheme.color.row.selected
  })

  it('메뉴의 설정 항목이 onSettings를 부른다', () => {
    const onSettings = vi.fn()
    wrap(row({ onSettings }))
    fireEvent.click(screen.getByRole('button', { name: 'prod 더 보기' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '설정' }))
    expect(onSettings).toHaveBeenCalledOnce()
  })
})
