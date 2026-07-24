import type {
  CapabilityExecuteInput,
  CapabilityExecutor,
  OperationPayload,
} from '../../core/execution/CapabilityExecutor'
import type { StreamHub } from '../../core/stream/StreamHub'

/**
 * `kind: 'stream'` 요청을 처리한다. listTopics는 드라이버 직접(rows 재사용),
 * subscribe/unsubscribe는 StreamHub 경유(장수명 구독은 lease 밖 hub 상태).
 * subscribe는 표가 아니라 subscriptionId를 주므로 `streamAck` payload를 쓴다 —
 * 실제 메시지는 push 채널로 흐른다.
 */
export class StreamCapabilityExecutor implements CapabilityExecutor {
  readonly kind = 'stream' as const

  constructor(private readonly hub: StreamHub) {}

  async execute(input: CapabilityExecuteInput): Promise<OperationPayload> {
    const { driver, operation, ctx, page, connectionId } = input

    if (operation.kind !== 'stream') {
      throw new Error(`StreamCapabilityExecutor received ${operation.kind}`)
    }

    const stream = driver.stream
    if (stream === undefined) throw new Error('driver does not support stream capability')

    switch (operation.op) {
      case 'listTopics':
        return { kind: 'rows', rows: await stream.listTopics(ctx, page) }
      case 'subscribe': {
        const subscriptionId = await this.hub.subscribe(
          connectionId,
          ctx,
          { topic: operation.topic, from: operation.from },
          stream,
        )
        return { kind: 'streamAck', subscriptionId }
      }
      case 'unsubscribe':
        await this.hub.unsubscribe(operation.subscriptionId)
        return { kind: 'streamAck', subscriptionId: null }
    }
  }
}
