// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { OperationGateway, OperationOutcome } from '@renderer/gateways/ports/OperationGateway'
import { useQueryRunner } from '@renderer/features/query/model/useQueryRunner'
import type { ResultSet } from '@shared/types/resultSet'

function resultSet(over: Partial<ResultSet> = {}): ResultSet {
  return {
    requestId: 'r', columns: [{ name: 'id', type: '23' }],
    rows: [[{ t: 'int', v: 1 }]],
    page: { cursor: null, hasMore: false, rowCount: 1, bytes: 10 },
    meta: { durationMs: 1, truncatedRows: false, truncatedBytes: false, rowsAffected: null },
    ...over,
  }
}
function gatewayReturning(outcome: OperationOutcome): OperationGateway & { run: ReturnType<typeof vi.fn> } {
  return {
    run: vi.fn().mockResolvedValue(outcome),
    cancel: vi.fn().mockResolvedValue(undefined),
    recentAudit: vi.fn().mockResolvedValue([]),
  }
}

interface Deferred<T> {
  readonly promise: Promise<T>
  resolve: (v: T) => void
}
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe('useQueryRunner', () => {
  it('run이 게이트웨이를 부르고 결과를 노출한다', async () => {
    const gw = gatewayReturning({ ok: true, payload: { kind: 'rows', rows: resultSet() } })
    const { result } = renderHook(() => useQueryRunner(gw, 'c1'))
    act(() => result.current.setSql('SELECT 1'))
    await act(async () => { await result.current.run() })
    expect(gw.run).toHaveBeenCalled()
    expect(result.current.rows).toHaveLength(1)
    expect(result.current.columns[0]?.name).toBe('id')
  })

  it('쓰기 결과의 rowsAffected를 노출한다', async () => {
    const rs = resultSet({ rows: [], meta: { durationMs: 1, truncatedRows: false, truncatedBytes: false, rowsAffected: 3 } })
    const gw = gatewayReturning({ ok: true, payload: { kind: 'rows', rows: rs } })
    const { result } = renderHook(() => useQueryRunner(gw, 'c1'))
    await act(async () => { await result.current.run() })
    expect(result.current.rowsAffected).toBe(3)
  })

  it('ok:false면 오류를 노출한다', async () => {
    const gw = gatewayReturning({ ok: false, reason: 'denied' })
    const { result } = renderHook(() => useQueryRunner(gw, 'c1'))
    await act(async () => { await result.current.run() })
    expect(result.current.error).toBe('denied')
  })

  it('loadMore가 커서로 이어 fetch해 누적한다', async () => {
    const page1 = resultSet({ rows: [[{ t: 'int', v: 1 }]], page: { cursor: 'pg:1', hasMore: true, rowCount: 1, bytes: 10 } })
    const page2 = resultSet({ rows: [[{ t: 'int', v: 2 }]], page: { cursor: null, hasMore: false, rowCount: 1, bytes: 10 } })
    const gw: OperationGateway = {
      run: vi.fn()
        .mockResolvedValueOnce({ ok: true, payload: { kind: 'rows', rows: page1 } })
        .mockResolvedValueOnce({ ok: true, payload: { kind: 'rows', rows: page2 } }),
      cancel: vi.fn().mockResolvedValue(undefined),
      recentAudit: vi.fn().mockResolvedValue([]),
    }
    const { result } = renderHook(() => useQueryRunner(gw, 'c1'))
    await act(async () => { await result.current.run() })
    expect(result.current.hasMore).toBe(true)
    await act(async () => { await result.current.loadMore() })
    // 누적: 1행 + 1행 = 2행. append가 아니라 교체하면 이 단언이 깨진다.
    expect(result.current.rows).toHaveLength(2)
    expect(result.current.hasMore).toBe(false)
  })

  it('성공 후 실패한 run은 이전 결과(columns/rows)를 지운다', async () => {
    const gw: OperationGateway = {
      run: vi.fn()
        .mockResolvedValueOnce({ ok: true, payload: { kind: 'rows', rows: resultSet() } })
        .mockResolvedValueOnce({ ok: false, reason: 'syntax error' }),
      cancel: vi.fn().mockResolvedValue(undefined),
      recentAudit: vi.fn().mockResolvedValue([]),
    }
    const { result } = renderHook(() => useQueryRunner(gw, 'c1'))
    await act(async () => { await result.current.run() })
    expect(result.current.columns).toHaveLength(1)
    await act(async () => { await result.current.run() })
    expect(result.current.error).toBe('syntax error')
    expect(result.current.columns).toHaveLength(0)
    expect(result.current.rows).toHaveLength(0)
  })

  it('loadMore이 진행 중이면 같은 커서로 중복 fetch하지 않는다', async () => {
    const page1 = resultSet({ rows: [[{ t: 'int', v: 1 }]], page: { cursor: 'pg:1', hasMore: true, rowCount: 1, bytes: 10 } })
    const page2Outcome: OperationOutcome = {
      ok: true,
      payload: {
        kind: 'rows',
        rows: resultSet({ rows: [[{ t: 'int', v: 2 }]], page: { cursor: null, hasMore: false, rowCount: 1, bytes: 10 } }),
      },
    }
    const page2 = deferred<OperationOutcome>()
    const run = vi.fn()
      .mockResolvedValueOnce({ ok: true, payload: { kind: 'rows', rows: page1 } })
      .mockReturnValueOnce(page2.promise)
    const gw: OperationGateway = {
      run,
      cancel: vi.fn().mockResolvedValue(undefined),
      recentAudit: vi.fn().mockResolvedValue([]),
    }
    const { result } = renderHook(() => useQueryRunner(gw, 'c1'))
    await act(async () => { await result.current.run() })
    expect(result.current.hasMore).toBe(true)

    let firstCall: Promise<void> = Promise.resolve()
    let secondCall: Promise<void> = Promise.resolve()
    act(() => {
      firstCall = result.current.loadMore()
      secondCall = result.current.loadMore()
    })
    await act(async () => {
      page2.resolve(page2Outcome)
      await Promise.all([firstCall, secondCall])
    })

    // run: 1회(첫 run) + 1회(page2 fetch) = 2회. in-flight 가드가 없으면
    // 두 번째 loadMore 호출이 같은 커서로 또 fetch해 3회가 된다.
    expect(run).toHaveBeenCalledTimes(2)
    expect(result.current.rows).toHaveLength(2)
  })

  it('cancel이 진행 중 요청을 취소한다', async () => {
    const inFlight = deferred<OperationOutcome>()
    const run = vi.fn().mockReturnValue(inFlight.promise)
    const gw: OperationGateway = {
      run,
      cancel: vi.fn().mockResolvedValue(undefined),
      recentAudit: vi.fn().mockResolvedValue([]),
    }
    const { result } = renderHook(() => useQueryRunner(gw, 'c1'))

    let runCall: Promise<void> = Promise.resolve()
    act(() => {
      runCall = result.current.run()
    })
    expect(result.current.running).toBe(true)
    const requestId = (run.mock.calls[0] as [{ requestId: string }])[0].requestId

    act(() => result.current.cancel())
    // eslint-disable-next-line @typescript-eslint/unbound-method -- vi.fn mock, no `this` binding involved
    expect(gw.cancel).toHaveBeenCalledWith(requestId)

    await act(async () => {
      inFlight.resolve({ ok: true, payload: { kind: 'rows', rows: resultSet() } })
      await runCall
    })
  })
})
