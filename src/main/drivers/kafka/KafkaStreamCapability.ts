import { buildResultSet, type PageRequest, type ResultSet } from '@shared/types/resultSet'
import { wire } from '@shared/types/wire'
import type { ExecutionContext } from '@main/core/driver/ExecutionContext'
import type {
  StreamCapability, StreamHandle, StreamMessage, StreamMessageSink, StreamSubscribeReq,
} from '@main/core/driver/capabilities/StreamCapability'
import type { KafkaAdminLike, KafkaConsumerLike, KafkaMessageLike } from './KafkaDriver'

export interface KafkaStreamDeps {
  readonly getAdmin: () => KafkaAdminLike
  readonly newConsumer: () => KafkaConsumerLike
  readonly nextGroupId: () => string
  readonly trackConsumer: (c: KafkaConsumerLike) => void
  readonly untrackConsumer: (c: KafkaConsumerLike) => void
}

const TOPIC_CURSOR_PREFIX = 'kafka:topics:1:'

/** kafkajs 메시지를 4a StreamMessage로(순수). meta에 엔진 좌표(partition/offset). */
export function toStreamMessage(partition: number, message: KafkaMessageLike): StreamMessage {
  // Number('')는 0(NaN 아님)이라 별도로 걸러야 한다 — 빈 문자열도 "타임스탬프 없음"으로 취급.
  const ts = message.timestamp === '' ? NaN : Number(message.timestamp)
  return {
    key: message.key === null ? null : message.key.toString(),
    value: message.value === null ? '' : message.value.toString(),
    timestamp: Number.isFinite(ts) && ts >= 0 ? ts : null,
    meta: { partition, offset: message.offset },
  }
}

function decodeTopicCursor(cursor: string): number {
  if (!cursor.startsWith(TOPIC_CURSOR_PREFIX)) throw new Error(`malformed cursor: ${cursor}`)
  const offset = Number(cursor.slice(TOPIC_CURSOR_PREFIX.length))
  if (!Number.isInteger(offset) || offset < 0) throw new Error(`malformed cursor: ${cursor}`)
  return offset
}

/**
 * Kafka 스트리밍 능력. v1은 읽기 전용(listTopics + 비파괴 tail).
 *
 * subscribe는 fresh 랜덤 groupId consumer로 tail한다 — autoCommit:false라 오프셋을
 * 커밋하지 않으므로 비파괴다. 정리는 handle.stop → consumer.disconnect(hub가 구동).
 * ctx.signal은 subscribe 반환 후 inert다(4a 계약) — teardown은 handle.stop 전용.
 */
export class KafkaStreamCapability implements StreamCapability {
  constructor(private readonly deps: KafkaStreamDeps) {}

  async listTopics(ctx: ExecutionContext, page: PageRequest): Promise<ResultSet> {
    const start = performance.now()
    const all = await this.deps.getAdmin().listTopics()
    // 내부 토픽(__consumer_offsets 등)은 감춘다.
    const names = all.filter((n) => !n.startsWith('__')).sort()
    const offset = page.cursor === null ? 0 : decodeTopicCursor(page.cursor)
    const total = names.length
    const rows = names.slice(offset).map((name) => [wire.str(name)])

    return buildResultSet({
      requestId: ctx.requestId,
      columns: [{ name: 'name', type: 'str' }],
      rows,
      page,
      durationMs: performance.now() - start,
      cursorAt: (kept) => (offset + kept < total ? `${TOPIC_CURSOR_PREFIX}${offset + kept}` : null),
    })
  }

  async subscribe(_ctx: ExecutionContext, req: StreamSubscribeReq, sink: StreamMessageSink): Promise<StreamHandle> {
    const consumer = this.deps.newConsumer()
    this.deps.trackConsumer(consumer)
    try {
      await consumer.connect()
      await consumer.subscribe({ topic: req.topic, fromBeginning: req.from === 'earliest' })
      await consumer.run({
        autoCommit: false, // 비파괴: 오프셋을 커밋하지 않는다.
        eachMessage: ({ partition, message }) => {
          sink.emit([toStreamMessage(partition, message)])
          return Promise.resolve()
        },
      })
    } catch (error) {
      // 시작 실패 시 consumer를 정리하고 추적에서 뺀다.
      this.deps.untrackConsumer(consumer)
      await consumer.disconnect().catch(() => {})
      throw error
    }

    return {
      stop: async () => {
        this.deps.untrackConsumer(consumer)
        await consumer.disconnect()
      },
    }
  }
}
