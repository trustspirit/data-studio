// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { OperationGateway } from '@renderer/gateways/ports/OperationGateway'
import { useKeys } from '@renderer/features/keys/model/useKeys'
import type { ResultSet } from '@shared/types/resultSet'
import type { WireValue } from '@shared/types/wire'

function keyRow(key: string, type: string, ttl: number): readonly WireValue[] {
  return [{ t: 'str', v: key }, { t: 'str', v: type }, { t: 'int', v: ttl }]
}

function scanResult(rows: readonly (readonly WireValue[])[], cursor: string | null = null): ResultSet {
  return {
    requestId: 'r',
    columns: [],
    rows,
    page: { cursor, hasMore: cursor !== null, rowCount: rows.length, bytes: 10 },
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

describe('useKeys', () => {
  it('run이 scan 결과를 KeyRow로 노출한다', async () => {
    const gw = gateway(() => ({
      ok: true,
      payload: { kind: 'rows', rows: scanResult([keyRow('u:1', 'string', -1), keyRow('l:1', 'list', 5000)]) },
    }))
    const { result } = renderHook(() => useKeys(gw, 'c1'))
    act(() => { result.current.run('u:*') })
    await waitFor(() => expect(result.current.keys).toHaveLength(2))
    expect(result.current.keys[0]).toEqual({ key: 'u:1', type: 'string', ttl: -1 })
    expect(result.current.keys[1]).toEqual({ key: 'l:1', type: 'list', ttl: 5000 })
  })

  it('run 실패 시 error를 노출한다', async () => {
    const gw = gateway(() => ({ ok: false, reason: 'capability_missing' }))
    const { result } = renderHook(() => useKeys(gw, 'c1'))
    act(() => { result.current.run('*') })
    await waitFor(() => expect(result.current.error).toBe('capability_missing'))
  })

  it('match를 지정하면 scan 요청에 match를 싣는다', async () => {
    const run = vi.fn().mockResolvedValue({ ok: true, payload: { kind: 'rows', rows: scanResult([]) } })
    const gw: OperationGateway = { run: run as OperationGateway['run'], cancel: vi.fn().mockResolvedValue(undefined), recentAudit: vi.fn().mockResolvedValue([]) }
    const { result } = renderHook(() => useKeys(gw, 'c1'))
    act(() => { result.current.run('u:*') })
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1))
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ connectionId: 'c1', operation: { kind: 'keyvalue', op: 'scan', match: 'u:*' } }),
    )
  })

  it('loadMore가 커서로 이어 scan해 누적한다', async () => {
    const page1 = scanResult([keyRow('a', 'string', -1)], 'cursor1')
    const page2 = scanResult([keyRow('b', 'string', -1)], null)
    const run = vi.fn()
      .mockResolvedValueOnce({ ok: true, payload: { kind: 'rows', rows: page1 } })
      .mockResolvedValueOnce({ ok: true, payload: { kind: 'rows', rows: page2 } })
    const gw: OperationGateway = { run: run as OperationGateway['run'], cancel: vi.fn().mockResolvedValue(undefined), recentAudit: vi.fn().mockResolvedValue([]) }
    const { result } = renderHook(() => useKeys(gw, 'c1'))
    act(() => { result.current.run('*') })
    await waitFor(() => expect(result.current.hasMore).toBe(true))
    await act(async () => { await result.current.loadMore() })
    await waitFor(() => expect(result.current.keys).toHaveLength(2))
  })
})
