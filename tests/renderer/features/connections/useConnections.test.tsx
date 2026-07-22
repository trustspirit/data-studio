// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ConnectionConfig } from '@shared/types/connection'
import type { ConnectionGateway } from '@renderer/gateways/ports/ConnectionGateway'
import { useConnections } from '@renderer/features/connections/model/useConnections'

function conn(id: string): ConnectionConfig {
  return {
    id,
    name: id,
    engine: 'postgres',
    host: 'h',
    port: 5432,
    database: 'd',
    username: 'u',
    tlsMode: 'disable',
    aiReadOnlyUsername: null,
    maskedColumnPatterns: [],
  }
}

function fakeGateway(initial: ConnectionConfig[]): ConnectionGateway & { store: ConnectionConfig[] } {
  const store = [...initial]
  return {
    store,
    list: vi.fn(() => Promise.resolve([...store])),
    save: vi.fn((c: ConnectionConfig) => {
      const i = store.findIndex((x) => x.id === c.id)
      if (i >= 0) store[i] = c
      else store.push(c)
      return Promise.resolve()
    }),
    delete: vi.fn((id: string) => {
      const i = store.findIndex((x) => x.id === id)
      if (i >= 0) store.splice(i, 1)
      return Promise.resolve()
    }),
    setSecret: vi.fn(() => Promise.resolve()),
    hasSecret: vi.fn(() => Promise.resolve(false)),
    secretsPersistent: vi.fn(() => Promise.resolve(true)),
    open: vi.fn(() => Promise.resolve({ opened: true }) as ReturnType<ConnectionGateway['open']>),
    close: vi.fn(() => Promise.resolve()),
    status: vi.fn(() => Promise.resolve('ready') as ReturnType<ConnectionGateway['status']>),
    openFileDialog: vi.fn(() => Promise.resolve(null)),
  }
}

describe('useConnections', () => {
  it('마운트 시 목록을 로드한다', async () => {
    const gw = fakeGateway([conn('a'), conn('b')])
    const { result } = renderHook(() => useConnections(gw))
    await waitFor(() => expect(result.current.connections).toHaveLength(2))
  })

  it('save가 게이트웨이를 호출하고 목록을 갱신한다', async () => {
    const gw = fakeGateway([])
    const { result } = renderHook(() => useConnections(gw))
    await act(async () => {
      await result.current.save(conn('new'))
    })
    // eslint-disable-next-line @typescript-eslint/unbound-method -- vi.fn mock, no `this` binding involved
    expect(gw.save).toHaveBeenCalledOnce()
    expect(result.current.connections.map((c) => c.id)).toContain('new')
    expect(result.current.selectedId).toBe('new')
  })

  it('remove가 게이트웨이를 호출하고 목록에서 뺀다', async () => {
    const gw = fakeGateway([conn('a')])
    const { result } = renderHook(() => useConnections(gw))
    await waitFor(() => expect(result.current.connections).toHaveLength(1))
    act(() => result.current.select('a'))
    await act(async () => {
      await result.current.remove('a')
    })
    // eslint-disable-next-line @typescript-eslint/unbound-method -- vi.fn mock, no `this` binding involved
    expect(gw.delete).toHaveBeenCalledWith('a')
    expect(result.current.connections).toHaveLength(0)
    // 삭제한 항목이 선택 상태였다면 선택을 해제해야 한다.
    expect(result.current.selectedId).toBeNull()
  })

  it('게이트웨이 오류를 error 상태로 노출한다', async () => {
    const gw = fakeGateway([])
    gw.list = vi.fn(() => Promise.reject(new Error('ipc connection:list failed: internal_error')))
    const { result } = renderHook(() => useConnections(gw))
    await waitFor(() => expect(result.current.error).toMatch(/internal_error/))
  })

  it('선택되지 않은 항목을 제거해도 선택 상태를 유지한다', async () => {
    const gw = fakeGateway([conn('a'), conn('b')])
    const { result } = renderHook(() => useConnections(gw))
    await waitFor(() => expect(result.current.connections).toHaveLength(2))
    act(() => result.current.select('a'))
    await act(async () => {
      await result.current.remove('b')
    })
    expect(result.current.connections.map((c) => c.id)).not.toContain('b')
    expect(result.current.selectedId).toBe('a')
  })

  it('save 실패 시 error 상태로 노출한다', async () => {
    const gw = fakeGateway([])
    gw.save = vi.fn(() => Promise.reject(new Error('ipc connection:save failed: internal_error')))
    const { result } = renderHook(() => useConnections(gw))
    await waitFor(() => expect(result.current.connections).toHaveLength(0))
    await act(async () => {
      await result.current.save(conn('new'))
    })
    expect(result.current.error).toMatch(/internal_error/)
  })
})
