// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ConnectionGateway, OpenResult } from '@renderer/gateways/ports/ConnectionGateway'
import { useOpenConnections } from '@renderer/app/model/useOpenConnections'

function gateway(result: OpenResult = { opened: true, capabilities: ['sql'], aiAccount: 'none' }): ConnectionGateway {
  return {
    list: vi.fn(() => Promise.resolve([])),
    save: vi.fn(() => Promise.resolve()),
    delete: vi.fn(() => Promise.resolve()),
    setSecret: vi.fn(() => Promise.resolve()),
    hasSecret: vi.fn(() => Promise.resolve(false)),
    secretsPersistent: vi.fn(() => Promise.resolve(true)),
    open: vi.fn(() => Promise.resolve(result)),
    close: vi.fn(() => Promise.resolve()),
    status: vi.fn(() => Promise.resolve('ready') as ReturnType<ConnectionGateway['status']>),
    openFileDialog: vi.fn(() => Promise.resolve(null)),
  }
}

describe('useOpenConnections', () => {
  it('성공한 열기가 ready·활성·펼침으로 남는다', async () => {
    const gw = gateway({ opened: true, capabilities: ['sql', 'schema'], aiAccount: 'ready' })
    const { result } = renderHook(() => useOpenConnections(gw))
    await act(async () => {
      await result.current.openConnection('a')
    })
    expect(result.current.open['a']?.state).toBe('ready')
    expect(result.current.open['a']?.capabilities).toEqual(['sql', 'schema'])
    expect(result.current.open['a']?.aiAccount).toBe('ready')
    expect(result.current.activeId).toBe('a')
    expect(result.current.expanded['a']).toBe(true)
  })

  it('같은 연결을 동시에 두 번 열어도 connection:open은 한 번만 나간다', async () => {
    const gw = gateway()
    const { result } = renderHook(() => useOpenConnections(gw))
    await act(async () => {
      await Promise.all([result.current.openConnection('a'), result.current.openConnection('a')])
    })
    // eslint-disable-next-line @typescript-eslint/unbound-method -- vi.fn mock, no `this` binding involved
    expect(gw.open).toHaveBeenCalledTimes(1)
  })

  it('열기 실패가 error 상태와 사유 문자열로 남고 활성이 되지 않는다', async () => {
    const gw = gateway({ opened: false, reason: 'password required' })
    const { result } = renderHook(() => useOpenConnections(gw))
    await act(async () => {
      await result.current.openConnection('a')
    })
    expect(result.current.open['a']?.state).toBe('error')
    expect(result.current.open['a']?.error).toBe('password required')
    expect(result.current.activeId).toBeNull()
  })

  it('게이트웨이가 예외를 던져도 error 상태로 남는다', async () => {
    const gw = gateway()
    gw.open = vi.fn(() => Promise.reject(new Error('ipc connection:open failed')))
    const { result } = renderHook(() => useOpenConnections(gw))
    await act(async () => {
      await result.current.openConnection('a')
    })
    expect(result.current.open['a']?.state).toBe('error')
    expect(result.current.open['a']?.error).toMatch(/connection:open/)
  })

  it('실패한 연결은 다시 열 수 있다', async () => {
    const gw = gateway({ opened: false, reason: 'refused' })
    const { result } = renderHook(() => useOpenConnections(gw))
    await act(async () => {
      await result.current.openConnection('a')
    })
    gw.open = vi.fn(() => Promise.resolve({ opened: true, capabilities: ['sql'], aiAccount: 'none' } as const))
    await act(async () => {
      await result.current.openConnection('a')
    })
    expect(result.current.open['a']?.state).toBe('ready')
    expect(result.current.activeId).toBe('a')
  })

  it('닫기가 connection:close를 부르고 엔트리를 지운다', async () => {
    const gw = gateway()
    const { result } = renderHook(() => useOpenConnections(gw))
    await act(async () => {
      await result.current.openConnection('a')
    })
    await act(async () => {
      await result.current.closeConnection('a')
    })
    // eslint-disable-next-line @typescript-eslint/unbound-method -- vi.fn mock, no `this` binding involved
    expect(gw.close).toHaveBeenCalledWith('a')
    expect(result.current.open['a']).toBeUndefined()
    expect(result.current.activeId).toBeNull()
  })

  it('활성 연결을 닫으면 남은 열린 연결로 활성이 넘어간다', async () => {
    const gw = gateway()
    const { result } = renderHook(() => useOpenConnections(gw))
    await act(async () => {
      await result.current.openConnection('a')
    })
    await act(async () => {
      await result.current.openConnection('b')
    })
    expect(result.current.activeId).toBe('b')
    await act(async () => {
      await result.current.closeConnection('b')
    })
    expect(result.current.activeId).toBe('a')
  })

  it('비활성 연결을 닫아도 활성은 그대로다', async () => {
    const gw = gateway()
    const { result } = renderHook(() => useOpenConnections(gw))
    await act(async () => {
      await result.current.openConnection('a')
    })
    await act(async () => {
      await result.current.openConnection('b')
    })
    await act(async () => {
      await result.current.closeConnection('a')
    })
    expect(result.current.activeId).toBe('b')
  })

  it('열리지 않은 연결은 활성으로 만들 수 없다', async () => {
    const gw = gateway()
    const { result } = renderHook(() => useOpenConnections(gw))
    act(() => result.current.setActive('ghost'))
    expect(result.current.activeId).toBeNull()
    await act(async () => {
      await result.current.openConnection('a')
    })
    await act(async () => {
      await result.current.openConnection('b')
    })
    act(() => result.current.setActive('a'))
    expect(result.current.activeId).toBe('a')
  })

  it('펼침과 선택은 연결별로 따로 유지된다', () => {
    const gw = gateway()
    const { result } = renderHook(() => useOpenConnections(gw))
    act(() => result.current.toggleExpanded('a'))
    expect(result.current.expanded['a']).toBe(true)
    expect(result.current.expanded['b']).toBeUndefined()

    act(() => result.current.setSelection('a', { schema: 'public', table: 'users' }))
    act(() => result.current.setSelection('b', { schema: 'sales', table: 'orders' }))
    expect(result.current.selection['a']).toEqual({ schema: 'public', table: 'users' })
    expect(result.current.selection['b']).toEqual({ schema: 'sales', table: 'orders' })
  })

  it('닫으면 그 연결의 테이블 선택도 사라진다', async () => {
    const gw = gateway()
    const { result } = renderHook(() => useOpenConnections(gw))
    await act(async () => {
      await result.current.openConnection('a')
    })
    act(() => result.current.setSelection('a', { schema: 'public', table: 'users' }))
    await act(async () => {
      await result.current.closeConnection('a')
    })
    // 닫힌 연결의 선택이 남아 있으면 다시 열었을 때 없어진 테이블을 가리킬 수 있다.
    expect(result.current.selection['a']).toBeUndefined()
  })

  it('닫기가 실패하면 사유를 남기고 엔트리를 지우지 않는다', async () => {
    const gw = gateway()
    const { result } = renderHook(() => useOpenConnections(gw))
    await act(async () => {
      await result.current.openConnection('a')
    })
    gw.close = vi.fn(() => Promise.reject(new Error('ipc connection:close failed')))
    await act(async () => {
      await result.current.closeConnection('a')
    })
    // 조용히 지우면 풀이 살아 있는데 UI만 닫힌 것처럼 보인다.
    expect(result.current.open['a']?.state).toBe('error')
    expect(result.current.open['a']?.error).toMatch(/connection:close/)
    expect(result.current.activeId).toBeNull()
  })

  it('forget이 셸 상태를 통째로 버린다', async () => {
    const gw = gateway()
    const { result } = renderHook(() => useOpenConnections(gw))
    await act(async () => {
      await result.current.openConnection('a')
    })
    act(() => result.current.setSelection('a', { schema: 'public', table: 'users' }))
    act(() => result.current.forget('a'))
    await waitFor(() => expect(result.current.open['a']).toBeUndefined())
    expect(result.current.expanded['a']).toBeUndefined()
    expect(result.current.selection['a']).toBeUndefined()
    expect(result.current.activeId).toBeNull()
    // forget은 셸 상태만 버린다 — 풀을 닫는 것은 closeConnection의 책임이다.
    // eslint-disable-next-line @typescript-eslint/unbound-method -- vi.fn mock, no `this` binding involved
    expect(gw.close).not.toHaveBeenCalled()
  })
})
