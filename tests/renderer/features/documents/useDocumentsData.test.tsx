// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { OperationGateway } from '@renderer/gateways/ports/OperationGateway'
import { useDocumentsData } from '@renderer/features/documents/model/useDocumentsData'
import type { ResultSet } from '@shared/types/resultSet'

function docsResult(over: Partial<ResultSet> = {}): ResultSet {
  return {
    requestId: 'r',
    columns: [{ name: '_doc', type: 'json' }],
    rows: [[{ t: 'json', v: '{"_id":{"$oid":"1"},"name":"Alice"}', truncated: false }]],
    page: { cursor: null, hasMore: false, rowCount: 1, bytes: 10 },
    meta: { durationMs: 1, truncatedRows: false, truncatedBytes: false, rowsAffected: null },
    ...over,
  }
}
function gateway(handler: (op: { collection?: string; filter?: string }) => Awaited<ReturnType<OperationGateway['run']>>): OperationGateway {
  return {
    run: vi.fn((req: { operation: { collection?: string; filter?: string } }) => Promise.resolve(handler(req.operation))) as OperationGateway['run'],
    cancel: vi.fn().mockResolvedValue(undefined),
    recentAudit: vi.fn().mockResolvedValue([]),
  }
}

describe('useDocumentsData', () => {
  it('초기엔 조회하지 않는다', () => {
    const gw = gateway(() => ({ ok: true, payload: { kind: 'rows', rows: docsResult() } }))
    const { result } = renderHook(() => useDocumentsData(gw, 'c1'))
    expect(result.current.rows).toHaveLength(0)
    // eslint-disable-next-line @typescript-eslint/unbound-method -- vi.fn mock
    expect(vi.mocked(gw.run)).not.toHaveBeenCalled()
  })

  it('run(collection, filter)이 find를 호출해 문서를 채운다', async () => {
    const gw = gateway(() => ({ ok: true, payload: { kind: 'rows', rows: docsResult() } }))
    const { result } = renderHook(() => useDocumentsData(gw, 'c1'))
    act(() => { result.current.run('users', '{}') })
    await waitFor(() => expect(result.current.rows).toHaveLength(1))
    expect(result.current.columns[0]?.name).toBe('_doc')
    // eslint-disable-next-line @typescript-eslint/unbound-method -- vi.fn mock
    const run = vi.mocked(gw.run)
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ connectionId: 'c1', operation: { kind: 'document', op: 'find', collection: 'users', filter: '{}' } }),
    )
  })

  it('loadMore가 커서로 이어 fetch해 누적한다', async () => {
    const page1 = docsResult({ rows: [[{ t: 'json', v: '{"a":1}', truncated: false }]], page: { cursor: 'mongo:1:1:users:{}::', hasMore: true, rowCount: 1, bytes: 10 } })
    const page2 = docsResult({ rows: [[{ t: 'json', v: '{"a":2}', truncated: false }]], page: { cursor: null, hasMore: false, rowCount: 1, bytes: 10 } })
    const run = vi.fn()
      .mockResolvedValueOnce({ ok: true, payload: { kind: 'rows', rows: page1 } })
      .mockResolvedValueOnce({ ok: true, payload: { kind: 'rows', rows: page2 } })
    const gw: OperationGateway = { run: run as OperationGateway['run'], cancel: vi.fn().mockResolvedValue(undefined), recentAudit: vi.fn().mockResolvedValue([]) }
    const { result } = renderHook(() => useDocumentsData(gw, 'c1'))
    act(() => { result.current.run('users', '{}') })
    await waitFor(() => expect(result.current.hasMore).toBe(true))
    await act(async () => { await result.current.loadMore() })
    expect(result.current.rows).toHaveLength(2)
  })

  it('ok:false면 오류를 노출한다', async () => {
    const gw = gateway(() => ({ ok: false, reason: 'denied' }))
    const { result } = renderHook(() => useDocumentsData(gw, 'c1'))
    act(() => { result.current.run('users', '{}') })
    await waitFor(() => expect(result.current.error).toBe('denied'))
  })

  it('run이 다시 호출되면 이전 결과를 지우고 첫 페이지부터 다시 채운다', async () => {
    const gw = gateway(() => ({ ok: true, payload: { kind: 'rows', rows: docsResult() } }))
    const { result } = renderHook(() => useDocumentsData(gw, 'c1'))
    act(() => { result.current.run('users', '{}') })
    await waitFor(() => expect(result.current.rows).toHaveLength(1))
    act(() => { result.current.run('orders', '{"a":1}') })
    await waitFor(() => {
      // eslint-disable-next-line @typescript-eslint/unbound-method -- vi.fn mock
      expect(vi.mocked(gw.run)).toHaveBeenCalledTimes(2)
    })
    await waitFor(() => { expect(result.current.rows).toHaveLength(1) })
  })
})
