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

interface RunCall { op: string; subscriptionId: string | null | undefined }

/** 매 subscribe 호출마다 다른 subscriptionId('sub-1', 'sub-2', ...)를 순서대로 발급하되,
 * 각 subscribe의 resolve 시점은 테스트가 직접(resolveSubscribe(callIndex)) 제어한다.
 * onStreamMessage 등록을 id별로 추적하고, run()으로 보낸 op(특히 unsubscribe)을 모두 기록한다. */
function multiGateway() {
  let call = 0
  const resolvers: Array<() => void> = []
  const listeners = new Map<string, (b: StreamBatch) => void>()
  const unsubs = new Map<string, ReturnType<typeof vi.fn>>()
  const runCalls: RunCall[] = []
  return {
    gw: {
      run: (req: { operation: { op: string; subscriptionId?: string | null } }) => {
        runCalls.push({ op: req.operation.op, subscriptionId: req.operation.subscriptionId })
        if (req.operation.op === 'subscribe') {
          call += 1
          const id = `sub-${call}`
          return new Promise((resolve) => {
            resolvers[call - 1] = () => resolve({ ok: true, payload: { kind: 'streamAck', subscriptionId: id } })
          })
        }
        return Promise.resolve({ ok: true, payload: { kind: 'streamAck', subscriptionId: null } })
      },
      onStreamMessage: (id: string, l: (b: StreamBatch) => void) => {
        listeners.set(id, l)
        const u = vi.fn()
        unsubs.set(id, u)
        return u
      },
    } as unknown as OperationGateway,
    push: (id: string, b: StreamBatch) => listeners.get(id)?.(b),
    unsubOf: (id: string) => unsubs.get(id),
    /** 1-based: callIndex번째 subscribe 호출을 지금 resolve시킨다. */
    resolveSubscribe: (callIndex: number) => resolvers[callIndex - 1]?.(),
    runCalls,
  }
}

/** subscribe op의 resolve를 테스트가 직접 제어할 수 있는(deferred) 가짜 게이트웨이. */
function deferredGateway() {
  let resolveSubscribe: ((v: { ok: true; payload: { kind: 'streamAck'; subscriptionId: string } }) => void) | null = null
  const runCalls: RunCall[] = []
  return {
    gw: {
      run: (req: { operation: { op: string; subscriptionId?: string | null } }) => {
        runCalls.push({ op: req.operation.op, subscriptionId: req.operation.subscriptionId })
        if (req.operation.op === 'subscribe') {
          return new Promise((resolve) => { resolveSubscribe = resolve })
        }
        return Promise.resolve({ ok: true, payload: { kind: 'streamAck', subscriptionId: null } })
      },
      onStreamMessage: () => vi.fn(),
    } as unknown as OperationGateway,
    resolveSubscribeWith: (id: string) => resolveSubscribe?.({ ok: true, payload: { kind: 'streamAck', subscriptionId: id } }),
    runCalls,
  }
}

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

  it('재진입 start() 시 이전 구독은 orphan 처리되어 unsubscribe되고 최신 구독만 살아있다', async () => {
    const { gw, push, unsubOf, runCalls, resolveSubscribe } = multiGateway()
    const { result } = renderHook(() => useStreamSubscription(gw, 'c1'))

    // t1의 subscribe를 실제로 in-flight 상태로 만든 뒤(아직 resolve 전), 그 사이에 t2로 재진입한다.
    act(() => { result.current.start('t1', 'latest') })
    await waitFor(() => { expect(runCalls.filter((c) => c.op === 'subscribe')).toHaveLength(1) })

    act(() => { result.current.start('t2', 'latest') })
    await waitFor(() => { expect(runCalls.filter((c) => c.op === 'subscribe')).toHaveLength(2) })

    // t1(sub-1)의 subscribe를 먼저 resolve한다 — 이미 t2에 의해 대체되었으므로 orphan으로 즉시 unsubscribe되어야 한다.
    act(() => { resolveSubscribe(1) })
    await waitFor(() => {
      expect(runCalls.some((c) => c.op === 'unsubscribe' && c.subscriptionId === 'sub-1')).toBe(true)
    })

    // t2(sub-2)의 subscribe를 resolve하면 이것만 정상적으로 살아있는 구독이 된다.
    act(() => { resolveSubscribe(2) })
    await waitFor(() => { expect(result.current.running).toBe(true) })

    // sub-1은 리스너로 등록조차 되지 않았어야 하며(orphan), 밀어넣어도 rows에 영향이 없어야 한다.
    act(() => { push('sub-1', batch(['from-orphan'])) })
    await waitFor(() => { expect(result.current.rows).toHaveLength(0) })

    // sub-2가 유일하게 살아있는 구독이다.
    act(() => { push('sub-2', batch(['a', 'b'])) })
    await waitFor(() => { expect(result.current.rows).toHaveLength(2) })

    await waitFor(() => {
      expect(unsubOf('sub-1')).toBeUndefined() // sub-1은 onStreamMessage에 등록된 적이 없다
      expect(unsubOf('sub-2')).toBeDefined()
    })
  })

  it('구독 대기 중 언마운트되면 늦게 도착한 subscriptionId도 unsubscribe되어 서버 측에 고아를 남기지 않는다', async () => {
    const { gw, resolveSubscribeWith, runCalls } = deferredGateway()
    const { result, unmount } = renderHook(() => useStreamSubscription(gw, 'c1'))

    act(() => { result.current.start('t1', 'latest') })
    // subscribe가 실제로 in-flight 상태(main에 이미 전송됨)가 된 뒤에 언마운트한다.
    await waitFor(() => { expect(runCalls.some((c) => c.op === 'subscribe')).toBe(true) })
    unmount()

    // 언마운트 이후에야 subscribe가 resolve됨 — 이 subscriptionId는 orphan이므로 즉시 unsubscribe되어야 한다.
    act(() => { resolveSubscribeWith('sub-orphan') })

    await waitFor(() => {
      expect(runCalls.some((c) => c.op === 'unsubscribe' && c.subscriptionId === 'sub-orphan')).toBe(true)
    })
  })
})
