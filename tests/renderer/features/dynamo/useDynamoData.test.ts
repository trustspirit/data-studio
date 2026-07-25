// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import type { OperationGateway, OperationOutcome } from '@renderer/gateways/ports/OperationGateway'
import type { ResultSet } from '@shared/types/resultSet'
import { useDynamoData } from '@renderer/features/dynamo/model/useDynamoData'

function gatewayReturning(outcome: OperationOutcome) {
  const run = vi.fn(() => Promise.resolve(outcome))
  const gateway: OperationGateway = {
    run,
    cancel: vi.fn(() => Promise.resolve()),
    recentAudit: vi.fn(() => Promise.resolve([])),
    onStreamMessage: vi.fn(() => () => {}),
  }
  return { gateway, run }
}
const RS = (rows: ResultSet['rows']): ResultSet => ({ requestId: 'r', columns: [{ name: '_item', type: 'json' }], rows, page: { cursor: null, hasMore: false, rowCount: rows.length, bytes: 0 }, meta: { durationMs: 0, truncatedRows: false, truncatedBytes: false, rowsAffected: null } })

describe('useDynamoData', () => {
  it('runScan은 scan operation을 보낸다', async () => {
    const { gateway, run } = gatewayReturning({ ok: true, payload: { kind: 'rows', rows: RS([[{ t: 'json', v: '{"pk":"a"}', truncated: false }]]) } })
    const { result } = renderHook(() => useDynamoData(gateway, 'c1'))
    act(() => result.current.runScan('t'))
    await waitFor(() => expect(result.current.rows).toHaveLength(1))
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ operation: { kind: 'dynamo', op: 'scan', table: 't' } }))
  })

  it('runPartiql은 partiql operation을 보낸다', async () => {
    const { gateway, run } = gatewayReturning({ ok: true, payload: { kind: 'rows', rows: RS([]) } })
    const { result } = renderHook(() => useDynamoData(gateway, 'c1'))
    act(() => result.current.runPartiql('SELECT * FROM "t"'))
    await waitFor(() => expect(run).toHaveBeenCalled())
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ operation: { kind: 'dynamo', op: 'partiql', statement: 'SELECT * FROM "t"' } }))
  })

  it('실패 시 error를 담는다', async () => {
    const { gateway } = gatewayReturning({ ok: false, reason: 'boom' })
    const { result } = renderHook(() => useDynamoData(gateway, 'c1'))
    act(() => result.current.runScan('t'))
    await waitFor(() => expect(result.current.error).toBe('boom'))
  })
})
