import { describe, it, expect } from 'vitest'
import { toStreamMessage } from '@main/drivers/rabbitmq/RabbitStreamCapability'
import type { AmqpMessageLike } from '@main/drivers/rabbitmq/RabbitDriver'

function msg(over: Partial<AmqpMessageLike> = {}): AmqpMessageLike {
  return {
    content: Buffer.from('hello'),
    fields: { exchange: 'ex', routingKey: 'rk', deliveryTag: 3 },
    properties: {},
    ...over,
  }
}

describe('toStreamMessage', () => {
  it('content를 value로', () => {
    expect(toStreamMessage(msg({ content: Buffer.from('body') })).value).toBe('body')
  })
  it('routingKey가 key, 빈 문자열은 null', () => {
    expect(toStreamMessage(msg({ fields: { exchange: 'e', routingKey: 'k', deliveryTag: 1 } })).key).toBe('k')
    expect(toStreamMessage(msg({ fields: { exchange: 'e', routingKey: '', deliveryTag: 1 } })).key).toBeNull()
  })
  it('timestamp number면 그대로, 없으면 null', () => {
    expect(toStreamMessage(msg({ properties: { timestamp: 1690000000 } })).timestamp).toBe(1690000000)
    expect(toStreamMessage(msg({ properties: {} })).timestamp).toBeNull()
  })
  it('meta에 exchange/routingKey/deliveryTag', () => {
    expect(toStreamMessage(msg({ fields: { exchange: 'orders', routingKey: 'k9', deliveryTag: 42 } })).meta)
      .toEqual({ exchange: 'orders', routingKey: 'k9', deliveryTag: 42 })
  })
})

import { RabbitDriver } from '@main/drivers/rabbitmq/RabbitDriver'
import { RABBIT_AVAILABLE, RABBIT_HOST, withExchange } from '../../../contract/rabbitTestEnv'
import type { ConnectionConfig } from '@shared/types/connection'
import type { ExecutionContext } from '@main/core/driver/ExecutionContext'
import type { StreamMessage } from '@main/core/driver/capabilities/StreamCapability'

function liveCfg(): ConnectionConfig {
  return {
    id: 'conn-1', name: 't', engine: 'rabbitmq',
    host: RABBIT_HOST, port: 5672, database: '', username: 'guest',
    tlsMode: 'disable', aiReadOnlyUsername: null, maskedColumnPatterns: [],
  }
}
const deps = { getPassword: () => Promise.resolve('guest') }
const ctx = (): ExecutionContext => ({ requestId: 'r1', signal: new AbortController().signal })
const page = { cursor: null, maxRows: 1000, maxBytes: 8 * 1024 * 1024 }

/** sink가 count개 받을 때까지(또는 timeout) 기다린다. */
function collectingSink(count: number): { sink: { emit: (m: readonly StreamMessage[]) => void }; done: Promise<StreamMessage[]> } {
  const received: StreamMessage[] = []
  let resolve!: (v: StreamMessage[]) => void
  const done = new Promise<StreamMessage[]>((r) => { resolve = r })
  return {
    sink: { emit: (ms) => { received.push(...ms); if (received.length >= count) resolve([...received]) } },
    done,
  }
}
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

describe.skipIf(!RABBIT_AVAILABLE)('RabbitStreamCapability (실서버)', () => {
  it('listTopics가 생성한 exchange를 포함하고 amq.*를 감춘다', async () => {
    await withExchange('fanout', async (exchange) => {
      const d = new RabbitDriver(liveCfg(), deps)
      await d.connect(liveCfg())
      try {
        const rs = await d.stream.listTopics(ctx(), page)
        const names = rs.rows.map((r) => (r[0]?.t === 'str' ? r[0].v : ''))
        expect(names).toContain(exchange)
        expect(names.some((n) => n.startsWith('amq.'))).toBe(false)
      } finally { await d.disconnect() }
    })
  }, 20000)

  it('exchange tail이 publish된 메시지를 shape 맞게 받는다', async () => {
    await withExchange('fanout', async (exchange, publish) => {
      const d = new RabbitDriver(liveCfg(), deps)
      await d.connect(liveCfg())
      try {
        const { sink, done } = collectingSink(2)
        const handle = await d.stream.subscribe(ctx(), { topic: exchange, from: 'latest' }, sink)
        await sleep(300) // 바인딩이 자리잡을 시간
        publish('rk1', 'm1')
        publish('rk2', 'm2')
        const got = await done
        expect(got.map((m) => m.value).sort()).toEqual(['m1', 'm2'])
        expect(got[0]?.meta.exchange).toBe(exchange)
        await handle.stop()
      } finally { await d.disconnect() }
    })
  }, 20000)

  it('비파괴: 실제 durable 큐도 바인딩돼 있으면 tail이 받아도 실 큐가 전부 받는다', async () => {
    await withExchange('fanout', async (exchange, publish, conn) => {
      const ch = await conn.createChannel()
      const real = await ch.assertQueue('', { durable: false, autoDelete: true })
      await ch.bindQueue(real.queue, exchange, '')

      const d = new RabbitDriver(liveCfg(), deps)
      await d.connect(liveCfg())
      try {
        const { sink, done } = collectingSink(3)
        const handle = await d.stream.subscribe(ctx(), { topic: exchange, from: 'latest' }, sink)
        await sleep(300)
        publish('', 'a'); publish('', 'b'); publish('', 'c')
        expect((await done).length).toBe(3) // 우리 tail이 전부 받음
        await sleep(300)
        // 실제 큐도 독립적으로 3개 전부 보유(우리 소비가 실 큐를 비우지 않음)
        let realCount = 0
        for (let i = 0; i < 3; i++) { if (await ch.get(real.queue, { noAck: true })) realCount++ }
        expect(realCount).toBe(3)
        await handle.stop()
        await ch.close()
      } finally { await d.disconnect() }
    })
  }, 25000)
})
