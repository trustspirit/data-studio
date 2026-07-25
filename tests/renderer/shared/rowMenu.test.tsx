// @vitest-environment jsdom
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ThemeProvider, darkTheme } from '@renderer/shared/theme'
import { RowMenu, type RowMenuItem } from '@renderer/shared/ui'

function wrap(ui: React.ReactElement) {
  return render(<ThemeProvider theme={darkTheme}>{ui}</ThemeProvider>)
}

function menu(items: readonly RowMenuItem[]) {
  return <RowMenu label="prod 더 보기" items={items} testId="more-prod" />
}

const three = (onSelect = () => {}): readonly RowMenuItem[] => [
  { label: '설정', onSelect, testId: 'm-settings' },
  { label: '닫기', onSelect },
  { label: '삭제', onSelect, danger: true },
]

function trigger() {
  return screen.getByTestId('more-prod')
}
/** 실제 클릭은 pointerdown 뒤에 click이 온다. fireEvent.click은 앞의 것을 보내지 않는다. */
function realClick(el: HTMLElement) {
  fireEvent.pointerDown(el)
  fireEvent.click(el)
}

describe('RowMenu', () => {
  it('닫혀 있으면 항목을 그리지 않는다', () => {
    wrap(menu(three()))
    expect(screen.queryByRole('menu')).toBeNull()
    expect(trigger().getAttribute('aria-expanded')).toBe('false')
  })

  it('트리거를 누르면 항목이 열리고 첫 항목에 포커스가 간다', () => {
    wrap(menu(three()))
    fireEvent.click(trigger())
    expect(screen.getByRole('menu')).toBeTruthy()
    expect(trigger().getAttribute('aria-expanded')).toBe('true')
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: '설정' }))
  })

  it('항목을 고르면 동작을 부르고 닫는다', () => {
    const onSelect = vi.fn()
    wrap(menu([{ label: '설정', onSelect }]))
    fireEvent.click(trigger())
    fireEvent.click(screen.getByRole('menuitem', { name: '설정' }))
    expect(onSelect).toHaveBeenCalledOnce()
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('Escape로 닫고 포커스를 트리거로 돌려준다', () => {
    wrap(menu(three()))
    fireEvent.click(trigger())
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(trigger())
  })

  it('바깥을 누르면 닫힌다', () => {
    wrap(menu(three()))
    fireEvent.click(trigger())
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('트리거를 다시 누르면 닫힌 채로 있는다', () => {
    // 바깥 클릭 감지가 트리거까지 잡으면 여기서 닫혔다가 곧바로 다시 열린다.
    wrap(menu(three()))
    realClick(trigger())
    expect(screen.getByRole('menu')).toBeTruthy()
    realClick(trigger())
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('꺼진 항목은 포커스도 선택도 받지 않는다', () => {
    const onSelect = vi.fn()
    wrap(
      menu([
        { label: '닫기', onSelect, disabled: true },
        { label: '설정', onSelect },
      ]),
    )
    fireEvent.click(trigger())
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: '설정' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '닫기' }))
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('아래·위 화살표로 항목을 옮겨 다닌다', () => {
    wrap(menu(three()))
    fireEvent.click(trigger())
    const list = screen.getByRole('menu')
    fireEvent.keyDown(list, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: '닫기' }))
    fireEvent.keyDown(list, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: '설정' }))
  })

  it('마지막에서 아래를 누르면 처음으로 돌아온다', () => {
    wrap(menu(three()))
    fireEvent.click(trigger())
    const list = screen.getByRole('menu')
    fireEvent.keyDown(list, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: '삭제' }))
    fireEvent.keyDown(list, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: '설정' }))
  })

  it('메뉴를 행 바깥(body)에 그린다', () => {
    // 사이드바가 overflow:auto라 흐름 안에 두면 아래쪽 행에서 잘린다.
    const { container } = wrap(menu(three()))
    fireEvent.click(trigger())
    const list = screen.getByRole('menu')
    expect(container.contains(list)).toBe(false)
    expect(document.body.contains(list)).toBe(true)
  })

  it('스크롤하면 닫는다', () => {
    // 좌표를 열 때 한 번 재므로 스크롤한 뒤에는 낡는다.
    wrap(menu(three()))
    fireEvent.click(trigger())
    fireEvent.scroll(document, {})
    expect(screen.queryByRole('menu')).toBeNull()
  })
})
