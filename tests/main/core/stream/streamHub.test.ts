import { describe, it, expect } from 'vitest'
import { wire } from '@shared/types/wire'
import { StreamHub, type StreamPushPort } from '@main/core/stream/StreamHub'
import type { StreamBatch } from '@shared/types/stream'
import type {
  StreamCapability, StreamHandle, StreamMessage, StreamMessageSink, StreamSubscribeReq,
} from '@main/core/driver/capabilities/StreamCapability'
import type { ExecutionContext } from '@main/core/driver/ExecutionContext'
import type { ResultSet } from '@shared/types/resultSet'

/** setTimeout 콜백을 저장해 테스트가 수동으로 발화하는 결정적 clock. */
function makeClock() {
  const pending = new Map<number, () => void>()
  let seq = 0
  return {
    clock: {
      setTimeout: (fn: () => void): unknown => { const id = ++seq; pending.set(id, fn); return id },
      clearTimeout: (h: unknown): void => { pending.delete(h as number) },
    },
    /** 현재 예약된 콜백을 모두 한 번씩 발화한다(재예약분은 다음 tick에서). */
    tick: (): void => {
      const now = [...pending.entries()]
      pending.clear()
      for (const [, fn] of now) fn()
    },
  }
}

const ctx: ExecutionContext = { requestId: 'r1', signal: new AbortController().signal, resolveColumnOrigins: false }
const req: StreamSubscribeReq = { topic: 't', from: 'latest' }
const emptyRs = (): ResultSet => ({
  requestId: 'r', columns: [], rows: [],
  page: { cursor: null, hasMore: false, rowCount: 0, bytes: 0 },
  meta: { durationMs: 0, truncatedRows: false, truncatedBytes: false, rowsAffected: null },
})

/** 테스트가 sink를 붙잡아 직접 메시지를 밀어 넣을 수 있는 fake 드라이버. */
function fakeStream(): { cap: StreamCapability; sink(): StreamMessageSink; stopped(): number } {
  let captured: StreamMessageSink | null = null
  let stops = 0
  return {
    cap: {
      listTopics: () => Promise.resolve(emptyRs()),
      subscribe: (_c: ExecutionContext, _r: StreamSubscribeReq, sink: StreamMessageSink): Promise<StreamHandle> => {
        captured = sink
        return Promise.resolve({ stop: () => { stops++; return Promise.resolve() } })
      },
    },
    sink: () => { if (captured === null) throw new Error('not subscribed'); return captured },
    stopped: () => stops,
  }
}

const msg = (value: string): StreamMessage => ({ key: null, value, timestamp: 1, meta: { partition: 0, offset: value } })

describe('StreamHub', () => {
  it('subscribe→emit→flush가 push 포트로 배치를 민다', async () => {
    const { clock, tick } = makeClock()
    const pushed: { id: string; batch: StreamBatch }[] = []
    const push: StreamPushPort = (id, batch) => pushed.push({ id, batch })
    const hub = new StreamHub({ randomId: () => 'sub-1', clock, push })
    const drv = fakeStream()

    const id = await hub.subscribe('c1', ctx, req, drv.cap)
    expect(id).toBe('sub-1')

    drv.sink().emit([msg('a'), msg('b')])
    tick()

    expect(pushed).toHaveLength(1)
    expect(pushed[0]?.id).toBe('sub-1')
    expect(pushed[0]?.batch.rows).toHaveLength(2)
    expect(pushed[0]?.batch.columns.map((c) => c.name)).toEqual(['timestamp', 'key', 'value', 'meta'])
    expect(pushed[0]?.batch.droppedSince).toBe(0)
  })

  it('버퍼 상한 초과 시 오래된 것을 버리고 droppedSince로 알린다', async () => {
    const { clock, tick } = makeClock()
    const pushed: StreamBatch[] = []
    const hub = new StreamHub({ randomId: () => 's', clock, push: (_id, b) => pushed.push(b), config: { bufferCap: 2, flushMax: 100 } })
    const drv = fakeStream()
    await hub.subscribe('c1', ctx, req, drv.cap)

    drv.sink().emit([msg('a'), msg('b'), msg('c'), msg('d')]) // cap 2 → a,b 버려짐
    tick()

    expect(pushed[0]?.rows).toHaveLength(2)
    expect(pushed[0]?.droppedSince).toBe(2)
  })

  it('unsubscribe가 handle.stop을 부르고 이후 push가 없다', async () => {
    const { clock, tick } = makeClock()
    const pushed: StreamBatch[] = []
    const hub = new StreamHub({ randomId: () => 's', clock, push: (_i, b) => pushed.push(b) })
    const drv = fakeStream()
    const id = await hub.subscribe('c1', ctx, req, drv.cap)

    await hub.unsubscribe(id)
    expect(drv.stopped()).toBe(1)

    drv.sink().emit([msg('x')])
    tick()
    expect(pushed).toHaveLength(0)
  })

  it('없는 subscriptionId unsubscribe는 멱등', async () => {
    const { clock } = makeClock()
    const hub = new StreamHub({ randomId: () => 's', clock, push: () => {} })
    await expect(hub.unsubscribe('nope')).resolves.toBeUndefined()
  })

  it('closeConnection이 그 커넥션의 모든 구독을 정리한다', async () => {
    const { clock } = makeClock()
    let n = 0
    const hub = new StreamHub({ randomId: () => `s${++n}`, clock, push: () => {} })
    const a = fakeStream(); const b = fakeStream()
    await hub.subscribe('c1', ctx, req, a.cap)
    await hub.subscribe('c1', ctx, req, b.cap)
    await hub.closeConnection('c1')
    expect(a.stopped()).toBe(1)
    expect(b.stopped()).toBe(1)
  })

  it('flush 타이머가 매 interval마다 재예약된다(연속 tick으로 검증)', async () => {
    const { clock, tick } = makeClock()
    const pushed: { id: string; batch: StreamBatch }[] = []
    const push: StreamPushPort = (id, batch) => pushed.push({ id, batch })
    const hub = new StreamHub({ randomId: () => 'sub-1', clock, push })
    const drv = fakeStream()
    await hub.subscribe('c1', ctx, req, drv.cap)

    drv.sink().emit([msg('a')])
    tick()
    expect(pushed).toHaveLength(1)
    expect(pushed[0]?.batch.rows).toHaveLength(1)
    expect(pushed[0]?.batch.rows[0]?.[2]).toEqual(wire.str('a'))

    drv.sink().emit([msg('b')])
    tick()
    expect(pushed).toHaveLength(2)
    expect(pushed[1]?.batch.rows).toHaveLength(1)
    expect(pushed[1]?.batch.rows[0]?.[2]).toEqual(wire.str('b'))
  })

  it('droppedSince는 flush 이후 리셋되고 다음 flush에 누적되지 않는다', async () => {
    const { clock, tick } = makeClock()
    const pushed: StreamBatch[] = []
    const hub = new StreamHub({ randomId: () => 's', clock, push: (_id, b) => pushed.push(b), config: { bufferCap: 2, flushMax: 100 } })
    const drv = fakeStream()
    await hub.subscribe('c1', ctx, req, drv.cap)

    drv.sink().emit([msg('a'), msg('b'), msg('c'), msg('d')]) // cap 2 → a,b 버려짐
    tick()
    expect(pushed[0]?.droppedSince).toBe(2)

    drv.sink().emit([msg('e')]) // 드롭 없음
    tick()
    expect(pushed[1]?.droppedSince).toBe(0)
  })

  it('flushMax만큼만 배출하고 나머지는 다음 flush로 넘긴다', async () => {
    const { clock, tick } = makeClock()
    const pushed: StreamBatch[] = []
    const hub = new StreamHub({ randomId: () => 's', clock, push: (_id, b) => pushed.push(b), config: { bufferCap: 1000, flushMax: 2 } })
    const drv = fakeStream()
    await hub.subscribe('c1', ctx, req, drv.cap)

    drv.sink().emit([msg('a'), msg('b'), msg('c')])
    tick()
    expect(pushed[0]?.rows).toHaveLength(2)

    tick()
    expect(pushed[1]?.rows).toHaveLength(1)
  })

  it('subscribe 중 드라이버가 던지면 구독이 남지 않는다', async () => {
    const { clock } = makeClock()
    const hub = new StreamHub({ randomId: () => 's', clock, push: () => {} })
    const failing: StreamCapability = {
      listTopics: () => Promise.resolve(emptyRs()),
      subscribe: () => Promise.reject(new Error('no topic')),
    }
    await expect(hub.subscribe('c1', ctx, req, failing)).rejects.toThrow('no topic')
    // 남은 구독이 없으므로 closeAll이 조용히 끝난다
    await expect(hub.closeAll()).resolves.toBeUndefined()
  })
})
