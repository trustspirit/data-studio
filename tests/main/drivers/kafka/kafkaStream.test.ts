import { describe, it, expect } from 'vitest'
import { toStreamMessage } from '@main/drivers/kafka/KafkaStreamCapability'
import type { KafkaMessageLike } from '@main/drivers/kafka/KafkaDriver'

function msg(over: Partial<KafkaMessageLike> = {}): KafkaMessageLike {
  return { key: null, value: Buffer.from('v'), timestamp: '1690000000000', offset: '5', ...over }
}

describe('toStreamMessage', () => {
  it('key null은 null, value는 문자열', () => {
    const m = toStreamMessage(2, msg({ key: null, value: Buffer.from('hello') }))
    expect(m.key).toBeNull()
    expect(m.value).toBe('hello')
  })
  it('key 있으면 문자열', () => {
    expect(toStreamMessage(0, msg({ key: Buffer.from('k1') })).key).toBe('k1')
  })
  it('value null은 빈 문자열(tombstone)', () => {
    expect(toStreamMessage(0, msg({ value: null })).value).toBe('')
  })
  it('timestamp를 숫자로, 음수/빈 값은 null', () => {
    expect(toStreamMessage(0, msg({ timestamp: '1690000000000' })).timestamp).toBe(1690000000000)
    expect(toStreamMessage(0, msg({ timestamp: '-1' })).timestamp).toBeNull()
    expect(toStreamMessage(0, msg({ timestamp: '' })).timestamp).toBeNull()
  })
  it('meta에 partition/offset', () => {
    expect(toStreamMessage(3, msg({ offset: '42' })).meta).toEqual({ partition: 3, offset: '42' })
  })
})

import { KafkaDriver } from '@main/drivers/kafka/KafkaDriver'
import { KAFKA_AVAILABLE, KAFKA_BROKERS, withTopic } from '../../../contract/kafkaTestEnv'
import type { ConnectionConfig } from '@shared/types/connection'
import type { ExecutionContext } from '@main/core/driver/ExecutionContext'
import type { StreamMessage } from '@main/core/driver/capabilities/StreamCapability'

function liveCfg(): ConnectionConfig {
  return {
    id: 'conn-1', name: 't', engine: 'kafka',
    host: KAFKA_BROKERS.join(','), port: 9092, database: '', username: '',
    tlsMode: 'disable', aiReadOnlyUsername: null, maskedColumnPatterns: [],
  }
}
const ctx = (): ExecutionContext => ({ requestId: 'r1', signal: new AbortController().signal, resolveColumnOrigins: false })
const page = { cursor: null, maxRows: 1000, maxBytes: 8 * 1024 * 1024 }

/** sink가 count개 메시지를 받을 때까지(또는 timeout) 기다린다. */
function collectingSink(count: number): { sink: { emit: (m: readonly StreamMessage[]) => void }; done: Promise<StreamMessage[]> } {
  const received: StreamMessage[] = []
  let resolve!: (v: StreamMessage[]) => void
  const done = new Promise<StreamMessage[]>((r) => { resolve = r })
  return {
    sink: { emit: (ms) => { received.push(...ms); if (received.length >= count) resolve([...received]) } },
    done,
  }
}

describe.skipIf(!KAFKA_AVAILABLE)('KafkaStreamCapability (실서버)', () => {
  it('listTopics가 생성한 토픽을 포함한다', async () => {
    await withTopic([], async (topic) => {
      const d = new KafkaDriver(liveCfg(), { getPassword: () => Promise.resolve(null) })
      await d.connect(liveCfg())
      try {
        const rs = await d.stream.listTopics(ctx(), page)
        const names = rs.rows.map((r) => (r[0]?.t === 'str' ? r[0].v : ''))
        expect(names).toContain(topic)
      } finally { await d.disconnect() }
    })
  }, 30000)

  it('subscribe(earliest)가 시드 메시지를 shape 맞게 tail한다', async () => {
    await withTopic(
      [{ value: 'm1' }, { key: 'k2', value: 'm2' }],
      async (topic) => {
        const d = new KafkaDriver(liveCfg(), { getPassword: () => Promise.resolve(null) })
        await d.connect(liveCfg())
        try {
          const { sink, done } = collectingSink(2)
          const handle = await d.stream.subscribe(ctx(), { topic, from: 'earliest' }, sink)
          const got = await done
          const values = got.map((m) => m.value).sort()
          expect(values).toEqual(['m1', 'm2'])
          const withKey = got.find((m) => m.value === 'm2')
          expect(withKey?.key).toBe('k2')
          expect(typeof withKey?.meta.partition).toBe('number')
          expect(typeof withKey?.meta.offset).toBe('string')
          await handle.stop()
        } finally { await d.disconnect() }
      },
    )
  }, 30000)

  it('비파괴: 같은 토픽을 두 번 earliest tail하면 둘 다 전체를 받는다(오프셋 미커밋)', async () => {
    await withTopic(
      [{ value: 'a' }, { value: 'b' }, { value: 'c' }],
      async (topic) => {
        const d = new KafkaDriver(liveCfg(), { getPassword: () => Promise.resolve(null) })
        await d.connect(liveCfg())
        try {
          const first = collectingSink(3)
          const h1 = await d.stream.subscribe(ctx(), { topic, from: 'earliest' }, first.sink)
          expect((await first.done).length).toBe(3)
          await h1.stop()

          const second = collectingSink(3)
          const h2 = await d.stream.subscribe(ctx(), { topic, from: 'earliest' }, second.sink)
          expect((await second.done).length).toBe(3) // fresh group이라 다시 전체 수신
          await h2.stop()
        } finally { await d.disconnect() }
      },
    )
  }, 40000)
})
