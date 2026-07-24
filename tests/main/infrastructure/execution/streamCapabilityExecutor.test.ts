import { describe, it, expect, vi } from 'vitest'
import { StreamCapabilityExecutor } from '@main/infrastructure/execution/StreamCapabilityExecutor'
import { StreamHub } from '@main/core/stream/StreamHub'
import type { CapabilityExecuteInput } from '@main/core/execution/CapabilityExecutor'
import type { Driver } from '@main/core/driver/Driver'
import type { StreamCapability, StreamHandle } from '@main/core/driver/capabilities/StreamCapability'
import type { ResultSet } from '@shared/types/resultSet'
import type { Operation } from '@shared/types/operation'

const rs = (): ResultSet => ({
  requestId: 'r', columns: [{ name: 'topic', type: 'str' }], rows: [],
  page: { cursor: null, hasMore: false, rowCount: 0, bytes: 0 },
  meta: { durationMs: 0, truncatedRows: false, truncatedBytes: false, rowsAffected: null },
})

function streamCap(over: Partial<StreamCapability> = {}): StreamCapability {
  return {
    listTopics: () => Promise.resolve(rs()),
    subscribe: (): Promise<StreamHandle> => Promise.resolve({ stop: () => Promise.resolve() }),
    ...over,
  }
}
function driverWith(stream: StreamCapability): Driver {
  return { id: 'c', engine: 'kafka', connect: () => Promise.resolve(), disconnect: () => Promise.resolve(), ping: () => Promise.resolve(0), stream }
}
const ctx = { requestId: 'r1', signal: new AbortController().signal }
const page = { cursor: null, maxRows: 100, maxBytes: 1000 }
function inputFor(driver: Driver, operation: Operation): CapabilityExecuteInput {
  return { ctx, driver, operation, page, limits: { timeoutMs: 1000, maxRows: 100, maxBytes: 1000 }, readOnlyScope: false, connectionId: 'conn-1' }
}
function hubWith() {
  return new StreamHub({
    randomId: () => 'sub-1',
    clock: { setTimeout: () => 0, clearTimeout: () => {} },
    push: () => {},
  })
}

describe('StreamCapabilityExecutor', () => {
  it('listTopics를 driver.stream.listTopics로 위임하고 rows payload를 준다', async () => {
    const cap = streamCap()
    const out = await new StreamCapabilityExecutor(hubWith()).execute(inputFor(driverWith(cap), { kind: 'stream', op: 'listTopics' }))
    expect(out).toEqual({ kind: 'rows', rows: rs() })
  })

  it('subscribe는 hub.subscribe로 위임하고 streamAck(subscriptionId)를 준다', async () => {
    const hub = hubWith()
    const spy = vi.spyOn(hub, 'subscribe')
    const cap = streamCap()
    const out = await new StreamCapabilityExecutor(hub).execute(
      inputFor(driverWith(cap), { kind: 'stream', op: 'subscribe', topic: 't', from: 'latest' }),
    )
    expect(out).toEqual({ kind: 'streamAck', subscriptionId: 'sub-1' })
    expect(spy).toHaveBeenCalledWith('conn-1', ctx, { topic: 't', from: 'latest' }, cap)
  })

  it('unsubscribe는 hub.unsubscribe로 위임하고 streamAck(null)을 준다', async () => {
    const hub = hubWith()
    const spy = vi.spyOn(hub, 'unsubscribe').mockResolvedValue(undefined)
    const out = await new StreamCapabilityExecutor(hub).execute(
      inputFor(driverWith(streamCap()), { kind: 'stream', op: 'unsubscribe', subscriptionId: 'sub-9' }),
    )
    expect(out).toEqual({ kind: 'streamAck', subscriptionId: null })
    expect(spy).toHaveBeenCalledWith('sub-9')
  })
})
