// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { OperationGateway, OperationOutcome } from '@renderer/gateways/ports/OperationGateway'
import { useTableData } from '@renderer/features/data/model/useTableData'
import type { TableSelection } from '@renderer/entities/schema-tree'
import type { ResultSet } from '@shared/types/resultSet'

function rowsResult(over: Partial<ResultSet> = {}): ResultSet {
  return {
    requestId: 'r', columns: [{ name: 'id', type: '23' }],
    rows: [[{ t: 'int', v: 1 }]],
    page: { cursor: null, hasMore: false, rowCount: 1, bytes: 10 },
    meta: { durationMs: 1, truncatedRows: false, truncatedBytes: false, rowsAffected: null },
    ...over,
  }
}
function gateway(handler: (op: { op: string; sort?: unknown }) => OperationOutcome): OperationGateway {
  return {
    run: vi.fn((req: { operation: { op: string; sort?: unknown } }) => Promise.resolve(handler(req.operation))) as OperationGateway['run'],
    cancel: vi.fn().mockResolvedValue(undefined),
    recentAudit: vi.fn().mockResolvedValue([]),
  }
}
const SEL: TableSelection = { schema: 'public', table: 'users' }

describe('useTableData', () => {
  it('선택이 없으면 조회하지 않는다', () => {
    const gw = gateway(() => ({ ok: true, payload: { kind: 'rows', rows: rowsResult() } }))
    const { result } = renderHook(() => useTableData(gw, 'c1', null, undefined))
    expect(result.current.rows).toHaveLength(0)
    // eslint-disable-next-line @typescript-eslint/unbound-method -- vi.fn mock
    expect(vi.mocked(gw.run)).not.toHaveBeenCalled()
  })

  it('선택되면 browse로 행을 채운다', async () => {
    const gw = gateway(() => ({ ok: true, payload: { kind: 'rows', rows: rowsResult() } }))
    const { result } = renderHook(() => useTableData(gw, 'c1', SEL, undefined))
    await waitFor(() => expect(result.current.rows).toHaveLength(1))
    expect(result.current.columns[0]?.name).toBe('id')
  })

  it('loadMore가 커서로 이어 fetch해 누적한다', async () => {
    const page1 = rowsResult({ rows: [[{ t: 'int', v: 1 }]], page: { cursor: 'p:1', hasMore: true, rowCount: 1, bytes: 10 } })
    const page2 = rowsResult({ rows: [[{ t: 'int', v: 2 }]], page: { cursor: null, hasMore: false, rowCount: 1, bytes: 10 } })
    const run = vi.fn()
      .mockResolvedValueOnce({ ok: true, payload: { kind: 'rows', rows: page1 } })
      .mockResolvedValueOnce({ ok: true, payload: { kind: 'rows', rows: page2 } })
    const gw: OperationGateway = { run: run as OperationGateway['run'], cancel: vi.fn().mockResolvedValue(undefined), recentAudit: vi.fn().mockResolvedValue([]) }
    const { result } = renderHook(() => useTableData(gw, 'c1', SEL, undefined))
    await waitFor(() => expect(result.current.hasMore).toBe(true))
    await act(async () => { await result.current.loadMore() })
    expect(result.current.rows).toHaveLength(2)
  })

  it('정렬이 바뀌면 첫 페이지부터 재조회한다', async () => {
    const run = vi.fn().mockResolvedValue({ ok: true, payload: { kind: 'rows', rows: rowsResult() } })
    const gw: OperationGateway = { run: run as OperationGateway['run'], cancel: vi.fn().mockResolvedValue(undefined), recentAudit: vi.fn().mockResolvedValue([]) }
    type Sort = { column: string; direction: 'asc' | 'desc' } | undefined
    const { rerender } = renderHook(({ s }: { s: Sort }) => useTableData(gw, 'c1', SEL, s), { initialProps: { s: undefined as Sort } })
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1))
    rerender({ s: { column: 'id', direction: 'desc' } })
    await waitFor(() => expect(run).toHaveBeenCalledTimes(2))
    const lastReq = run.mock.calls[1]?.[0] as { operation: { sort?: unknown } }
    expect(lastReq.operation.sort).toEqual({ column: 'id', direction: 'desc' })
  })

  it('ok:false면 오류를 노출한다', async () => {
    const gw = gateway(() => ({ ok: false, reason: 'denied' }))
    const { result } = renderHook(() => useTableData(gw, 'c1', SEL, undefined))
    await waitFor(() => expect(result.current.error).toBe('denied'))
  })

  it('reload()가 현재 선택으로 다시 조회한다', async () => {
    const run = vi.fn().mockResolvedValue({ ok: true, payload: { kind: 'rows', rows: rowsResult() } })
    const gw: OperationGateway = { run: run as OperationGateway['run'], cancel: vi.fn().mockResolvedValue(undefined), recentAudit: vi.fn().mockResolvedValue([]) }
    const { result } = renderHook(() => useTableData(gw, 'c1', SEL, undefined))
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1))
    await act(async () => { result.current.reload() })
    await waitFor(() => expect(run).toHaveBeenCalledTimes(2))
  })
})
