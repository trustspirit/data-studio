// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useStreamSubscription } from '@renderer/features/streams/model/useStreamSubscription'
import type { OperationGateway } from '@renderer/gateways/ports/OperationGateway'
import type { StreamBatch } from '@shared/types/stream'

/** subscribe→streamAck을 주고, onStreamMessage 리스너를 붙잡아 테스트가 배치를 밀 수 있게 한다. */
function gateway() {
  let listener: ((b: StreamBatch) => void) | null = null
  const unsub = vi.fn()
  return {
    gw: {
      run: (req: { operation: { op: string } }) => {
        if (req.operation.op === 'subscribe') return Promise.resolve({ ok: true, payload: { kind: 'streamAck', subscriptionId: 'sub-1' } })
        return Promise.resolve({ ok: true, payload: { kind: 'streamAck', subscriptionId: null } })
      },
      onStreamMessage: (_id: string, l: (b: StreamBatch) => void) => { listener = l; return unsub },
    } as unknown as OperationGateway,
    push: (b: StreamBatch) => listener?.(b),
    unsub,
  }
}

const batch = (values: string[], dropped = 0): StreamBatch => ({
  columns: [{ name: 'value', type: 'str' }],
  rows: values.map((v) => [{ t: 'str', v }]),
  droppedSince: dropped,
})

describe('useStreamSubscription', () => {
  it('start→push 배치가 행으로 누적되고 dropped를 합산한다', async () => {
    const { gw, push } = gateway()
    const { result } = renderHook(() => useStreamSubscription(gw, 'c1'))
    act(() => { result.current.start('t', 'latest') })
    await waitFor(() => expect(result.current.running).toBe(true))
    act(() => { push(batch(['a', 'b'], 1)) })
    await waitFor(() => expect(result.current.rows).toHaveLength(2))
    expect(result.current.dropped).toBe(1)
    act(() => { push(batch(['c'], 2)) })
    await waitFor(() => expect(result.current.rows).toHaveLength(3))
    expect(result.current.dropped).toBe(3)
  })

  it('stop이 구독을 해제하고 리스너를 뗀다', async () => {
    const { gw, unsub } = gateway()
    const { result } = renderHook(() => useStreamSubscription(gw, 'c1'))
    act(() => { result.current.start('t', 'latest') })
    await waitFor(() => expect(result.current.running).toBe(true))
    await act(async () => { await result.current.stop() })
    expect(result.current.running).toBe(false)
    expect(unsub).toHaveBeenCalled()
  })
})
