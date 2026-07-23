// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { OperationGateway } from '@renderer/gateways/ports/OperationGateway'
import { useKeyValue } from '@renderer/features/keys/model/useKeyValue'
import type { ResultSet } from '@shared/types/resultSet'
import type { WireValue } from '@shared/types/wire'

function getResult(rows: readonly (readonly WireValue[])[]): ResultSet {
  return {
    requestId: 'r',
    columns: [],
    rows,
    page: { cursor: null, hasMore: false, rowCount: rows.length, bytes: 10 },
    meta: { durationMs: 1, truncatedRows: false, truncatedBytes: false, rowsAffected: null },
  }
}

function gateway(handler: () => Awaited<ReturnType<OperationGateway['run']>>): OperationGateway {
  return {
    run: vi.fn(() => Promise.resolve(handler())),
    cancel: vi.fn().mockResolvedValue(undefined),
    recentAudit: vi.fn().mockResolvedValue([]),
  }
}

describe('useKeyValue', () => {
  it('load가 get 결과를 entry로 노출한다', async () => {
    const gw = gateway(() => ({
      ok: true,
      payload: {
        kind: 'rows',
        rows: getResult([[
          { t: 'str', v: 'list' }, { t: 'int', v: 5000 }, { t: 'json', v: '["a","b"]', truncated: false },
        ]]),
      },
    }))
    const { result } = renderHook(() => useKeyValue(gw, 'c1'))
    act(() => { result.current.load('l:1') })
    await waitFor(() => expect(result.current.entry).not.toBeNull())
    expect(result.current.entry).toEqual({ type: 'list', ttl: 5000, value: '["a","b"]' })
  })

  it('없는 키(빈 결과)는 entry null', async () => {
    const gw = gateway(() => ({ ok: true, payload: { kind: 'rows', rows: getResult([]) } }))
    const { result } = renderHook(() => useKeyValue(gw, 'c1'))
    act(() => { result.current.load('nope') })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.entry).toBeNull()
  })

  it('clear가 entry를 비운다', async () => {
    const gw = gateway(() => ({
      ok: true,
      payload: {
        kind: 'rows',
        rows: getResult([[
          { t: 'str', v: 'string' }, { t: 'int', v: -1 }, { t: 'json', v: '"hi"', truncated: false },
        ]]),
      },
    }))
    const { result } = renderHook(() => useKeyValue(gw, 'c1'))
    act(() => { result.current.load('k') })
    await waitFor(() => expect(result.current.entry).not.toBeNull())
    act(() => { result.current.clear() })
    await waitFor(() => expect(result.current.entry).toBeNull())
  })

  it('load 실패 시 error를 노출한다', async () => {
    const gw = gateway(() => ({ ok: false, reason: 'not found' }))
    const { result } = renderHook(() => useKeyValue(gw, 'c1'))
    act(() => { result.current.load('k') })
    await waitFor(() => expect(result.current.error).toBe('not found'))
  })
})
