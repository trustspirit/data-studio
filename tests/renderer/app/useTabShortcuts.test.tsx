// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { fireEvent } from '@testing-library/dom'
import { describe, expect, it, vi } from 'vitest'
import { useTabShortcuts } from '@renderer/app/model/useTabShortcuts'
import type { TabSet } from '@renderer/app/model/useDocumentTabs'

const TABS: TabSet = {
  documents: [
    { kind: 'table', schema: 'public', table: 'orders' },
    { kind: 'query', serial: 1 },
  ],
  activeKey: 'table:public.orders',
}

function setup(enabled = true, tabs: TabSet = TABS) {
  const onRequestClose = vi.fn()
  const onActivate = vi.fn()
  const view = renderHook(() => useTabShortcuts({ enabled, tabs, onRequestClose, onActivate }))
  return { onRequestClose, onActivate, unmount: view.unmount }
}

describe('useTabShortcuts', () => {
  it('Cmd+W로 활성 탭 닫기를 요청한다', () => {
    const { onRequestClose } = setup()
    fireEvent.keyDown(window, { key: 'w', metaKey: true })
    expect(onRequestClose).toHaveBeenCalledWith('table:public.orders')
  })

  it('Cmd+Alt+오른쪽으로 다음 탭을 활성화한다', () => {
    const { onActivate } = setup()
    fireEvent.keyDown(window, { key: 'ArrowRight', metaKey: true, altKey: true })
    expect(onActivate).toHaveBeenCalledWith('query:1')
  })

  it('마지막 탭에서 다음으로 가면 처음으로 돌아온다', () => {
    const { onActivate } = setup(true, { ...TABS, activeKey: 'query:1' })
    fireEvent.keyDown(window, { key: 'ArrowRight', metaKey: true, altKey: true })
    expect(onActivate).toHaveBeenCalledWith('table:public.orders')
  })

  it('Cmd+Alt+왼쪽으로 이전 탭을 활성화한다', () => {
    const { onActivate } = setup(true, { ...TABS, activeKey: 'query:1' })
    fireEvent.keyDown(window, { key: 'ArrowLeft', metaKey: true, altKey: true })
    expect(onActivate).toHaveBeenCalledWith('table:public.orders')
  })

  it('비활성 워크스페이스는 단축키를 듣지 않는다', () => {
    const { onRequestClose, onActivate } = setup(false)
    fireEvent.keyDown(window, { key: 'w', metaKey: true })
    fireEvent.keyDown(window, { key: 'ArrowRight', metaKey: true, altKey: true })
    expect(onRequestClose).not.toHaveBeenCalled()
    expect(onActivate).not.toHaveBeenCalled()
  })

  it('열린 탭이 없으면 아무 일도 하지 않는다', () => {
    const { onRequestClose } = setup(true, { documents: [], activeKey: null })
    fireEvent.keyDown(window, { key: 'w', metaKey: true })
    expect(onRequestClose).not.toHaveBeenCalled()
  })

  it('탭이 없는데 activeKey만 남아 있어도 닫기를 요청하지 않는다', () => {
    // documents가 비었는데 activeKey가 유령처럼 남아 있는 상태(정리 도중 등)에서도
    // 실제로 열린 탭이 아닌 키로 닫기를 요청해서는 안 된다.
    const { onRequestClose } = setup(true, { documents: [], activeKey: 'ghost-key' })
    fireEvent.keyDown(window, { key: 'w', metaKey: true })
    expect(onRequestClose).not.toHaveBeenCalled()
  })

  it('언마운트 후에는 단축키를 듣지 않는다', () => {
    const { onRequestClose, onActivate, unmount } = setup()
    unmount()
    fireEvent.keyDown(window, { key: 'w', metaKey: true })
    fireEvent.keyDown(window, { key: 'ArrowRight', metaKey: true, altKey: true })
    expect(onRequestClose).not.toHaveBeenCalled()
    expect(onActivate).not.toHaveBeenCalled()
  })
})
