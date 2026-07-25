import { buildResultSet, type PageRequest, type ResultSet } from '@shared/types/resultSet'
import { wire } from '@shared/types/wire'
import type { ExecutionContext } from '@main/core/driver/ExecutionContext'
import type {
  StreamCapability, StreamHandle, StreamMessage, StreamMessageSink, StreamSubscribeReq,
} from '@main/core/driver/capabilities/StreamCapability'
import type { AmqpChannelLike, AmqpConnectionLike, AmqpMessageLike } from './RabbitDriver'
import type { RabbitMgmtParams } from './rabbitConfig'

export interface RabbitStreamDeps {
  readonly getConnection: () => AmqpConnectionLike
  readonly getMgmt: () => RabbitMgmtParams
  readonly getVhost: () => string
  readonly httpGetJson: (url: string, auth: string) => Promise<unknown>
  readonly trackChannel: (c: AmqpChannelLike) => void
  readonly untrackChannel: (c: AmqpChannelLike) => void
}

const EXCHANGE_CURSOR_PREFIX = 'rabbit:exchanges:1:'

/** amqplib 메시지를 4a StreamMessage로(순수). meta에 엔진 좌표(exchange/routingKey/deliveryTag). */
export function toStreamMessage(msg: AmqpMessageLike): StreamMessage {
  const rk = msg.fields.routingKey
  return {
    key: rk === '' ? null : rk,
    value: msg.content.toString(),
    timestamp: typeof msg.properties.timestamp === 'number' ? msg.properties.timestamp : null,
    meta: { exchange: msg.fields.exchange, routingKey: rk, deliveryTag: msg.fields.deliveryTag },
  }
}

function decodeExchangeCursor(cursor: string): number {
  if (!cursor.startsWith(EXCHANGE_CURSOR_PREFIX)) throw new Error(`malformed cursor: ${cursor}`)
  const offset = Number(cursor.slice(EXCHANGE_CURSOR_PREFIX.length))
  if (!Number.isInteger(offset) || offset < 0) throw new Error(`malformed cursor: ${cursor}`)
  return offset
}

/** mgmt API /api/exchanges/{vhost} 응답에서 이름 배열을 뽑는다. 배열 아니면 던진다. */
function extractExchangeNames(payload: unknown): string[] {
  if (!Array.isArray(payload)) throw new Error('unexpected management API response for exchanges')
  const names: string[] = []
  for (const item of payload) {
    if (typeof item === 'object' && item !== null && 'name' in item) {
      const name = (item as { name: unknown }).name
      if (typeof name === 'string') names.push(name)
    }
  }
  return names
}

/**
 * RabbitMQ 스트리밍 능력. v1은 읽기 전용(listTopics + 비파괴 exchange-tail).
 *
 * subscribe는 대상 exchange에 임시 exclusive auto-delete 큐를 '#'로 바인딩해
 * 우리 사본만 noAck 소비한다 — 실제 큐·소비자에 무영향(비파괴). forward-only라
 * `from`은 무시한다(구독 시점 이후 메시지만). 정리는 handle.stop → channel.close
 * (exclusive 큐 자동 삭제, hub가 구동). listTopics는 AMQP가 열거 불가라 HTTP
 * 관리 API를 쓴다.
 */
export class RabbitStreamCapability implements StreamCapability {
  constructor(private readonly deps: RabbitStreamDeps) {}

  async listTopics(ctx: ExecutionContext, page: PageRequest): Promise<ResultSet> {
    const start = performance.now()
    const mgmt = this.deps.getMgmt()
    const vhost = this.deps.getVhost()
    const url = `${mgmt.url}/api/exchanges/${encodeURIComponent(vhost)}`
    const payload = await this.deps.httpGetJson(url, mgmt.auth)
    // 빈 문자열(default exchange)과 amq.* 내부 exchange는 감춘다.
    const names = extractExchangeNames(payload).filter((n) => n !== '' && !n.startsWith('amq.')).sort()

    const offset = page.cursor === null ? 0 : decodeExchangeCursor(page.cursor)
    const total = names.length
    const rows = names.slice(offset).map((name) => [wire.str(name)])

    return buildResultSet({
      requestId: ctx.requestId,
      columns: [{ name: 'name', type: 'str' }],
      rows,
      page,
      durationMs: performance.now() - start,
      cursorAt: (kept) => (offset + kept < total ? `${EXCHANGE_CURSOR_PREFIX}${offset + kept}` : null),
    })
  }

  async subscribe(_ctx: ExecutionContext, req: StreamSubscribeReq, sink: StreamMessageSink): Promise<StreamHandle> {
    const channel = await this.deps.getConnection().createChannel()
    this.deps.trackChannel(channel)
    try {
      const { queue } = await channel.assertQueue('', { exclusive: true, autoDelete: true })
      // '#'는 topic exchange의 catch-all. fanout은 패턴을 무시하고 전체를 보낸다.
      // direct/headers exchange는 라우팅이 맞지 않으면 메시지가 안 올 수 있다(best-effort).
      await channel.bindQueue(queue, req.topic, '#')
      await channel.consume(
        queue,
        (msg) => {
          if (msg !== null) sink.emit([toStreamMessage(msg)])
        },
        { noAck: true },
      )
    } catch (error) {
      this.deps.untrackChannel(channel)
      await channel.close().catch(() => {})
      throw error
    }

    return {
      stop: async () => {
        this.deps.untrackChannel(channel)
        await channel.close() // exclusive 큐는 채널 닫힘 시 자동 삭제
      },
    }
  }
}
