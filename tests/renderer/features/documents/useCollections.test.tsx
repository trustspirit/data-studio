// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { OperationGateway } from '@renderer/gateways/ports/OperationGateway'
import { useCollections } from '@renderer/features/documents/model/useCollections'
import type { ResultSet } from '@shared/types/resultSet'

function collectionsResult(names: readonly string[]): ResultSet {
  return {
    requestId: 'r',
    columns: [{ name: 'name', type: 'str' }],
    rows: names.map((n) => [{ t: 'str', v: n }]),
    page: { cursor: null, hasMore: false, rowCount: names.length, bytes: 10 },
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

describe('useCollections', () => {
  it('마운트 시 listCollections를 호출해 이름 목록을 채운다', async () => {
    const gw = gateway(() => ({ ok: true, payload: { kind: 'rows', rows: collectionsResult(['users', 'orders']) } }))
    const { result } = renderHook(() => useCollections(gw, 'c1'))
    await waitFor(() => expect(result.current.collections).toEqual(['users', 'orders']))
    // eslint-disable-next-line @typescript-eslint/unbound-method -- vi.fn mock
    const run = vi.mocked(gw.run)
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ connectionId: 'c1', operation: { kind: 'document', op: 'listCollections' } }),
    )
  })

  it('ok:false면 오류를 노출한다', async () => {
    const gw = gateway(() => ({ ok: false, reason: 'denied' }))
    const { result } = renderHook(() => useCollections(gw, 'c1'))
    await waitFor(() => expect(result.current.error).toBe('denied'))
  })

  it('reload()가 다시 조회한다', async () => {
    const run = vi.fn().mockResolvedValue({ ok: true, payload: { kind: 'rows', rows: collectionsResult(['a']) } })
    const gw: OperationGateway = { run: run as OperationGateway['run'], cancel: vi.fn().mockResolvedValue(undefined), recentAudit: vi.fn().mockResolvedValue([]) }
    const { result } = renderHook(() => useCollections(gw, 'c1'))
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1))
    act(() => { result.current.reload() })
    await waitFor(() => expect(run).toHaveBeenCalledTimes(2))
  })
})
