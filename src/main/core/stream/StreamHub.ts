import { wire } from '@shared/types/wire'
import type { ColumnDescriptor } from '@shared/types/resultSet'
import type { StreamBatch } from '@shared/types/stream'
import type { ExecutionContext } from '../driver/ExecutionContext'
import type {
  StreamCapability, StreamHandle, StreamMessage, StreamMessageSink, StreamSubscribeReq,
} from '../driver/capabilities/StreamCapability'

export type StreamPushPort = (subscriptionId: string, batch: StreamBatch) => void

/** 재예약 가능한 최소 타이머 표면(주입해 결정적 테스트). */
interface HubClock {
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

export interface StreamHubConfig {
  readonly bufferCap: number
  readonly flushMs: number
  readonly flushMax: number
}

const DEFAULTS: StreamHubConfig = { bufferCap: 1000, flushMs: 100, flushMax: 500 }

const STREAM_COLUMNS: readonly ColumnDescriptor[] = [
  { name: 'timestamp', type: 'int' },
  { name: 'key', type: 'str' },
  { name: 'value', type: 'str' },
  { name: 'meta', type: 'json' },
]

interface Subscription {
  readonly connectionId: string
  handle: StreamHandle
  readonly buffer: StreamMessage[]
  droppedSince: number
  timer: unknown
  active: boolean
}

export interface StreamHubDeps {
  readonly randomId: () => string
  readonly clock: HubClock
  readonly push: StreamPushPort
  readonly config?: Partial<StreamHubConfig>
}

/**
 * 라이브 구독의 서버측 관리자. 각 구독은 bounded ring buffer를 갖고, flush 타이머가
 * 주기적으로 버퍼를 비워 push 포트로 배치를 밀어 넣는다. 버퍼가 상한을 넘으면 오래된
 * 메시지를 버리고(drop-oldest) `droppedSince`를 올려 UI에 알린다(백프레셔).
 *
 * subscribe의 백그라운드 consumer는 OperationExecutor의 lease보다 오래 산다 —
 * 그래서 hub가 상태를 들고, unsubscribe/closeConnection/closeAll이 정리한다.
 */
export class StreamHub {
  private readonly subs = new Map<string, Subscription>()
  private readonly cfg: StreamHubConfig

  constructor(private readonly deps: StreamHubDeps) {
    this.cfg = { ...DEFAULTS, ...deps.config }
  }

  async subscribe(
    connectionId: string,
    ctx: ExecutionContext,
    req: StreamSubscribeReq,
    stream: StreamCapability,
  ): Promise<string> {
    const subscriptionId = this.deps.randomId()
    const sub: Subscription = {
      connectionId,
      handle: { stop: () => Promise.resolve() },
      buffer: [],
      droppedSince: 0,
      timer: null,
      active: true,
    }
    this.subs.set(subscriptionId, sub)

    const sink: StreamMessageSink = {
      emit: (messages) => {
        if (!sub.active) return
        for (const m of messages) {
          sub.buffer.push(m)
          if (sub.buffer.length > this.cfg.bufferCap) {
            sub.buffer.shift()
            sub.droppedSince++
          }
        }
      },
    }

    try {
      sub.handle = await stream.subscribe(ctx, req, sink)
    } catch (error) {
      this.subs.delete(subscriptionId)
      throw error
    }

    this.scheduleFlush(subscriptionId)
    return subscriptionId
  }

  private scheduleFlush(subscriptionId: string): void {
    const sub = this.subs.get(subscriptionId)
    if (sub === undefined || !sub.active) return
    sub.timer = this.deps.clock.setTimeout(() => {
      this.flush(subscriptionId)
      this.scheduleFlush(subscriptionId)
    }, this.cfg.flushMs)
  }

  private flush(subscriptionId: string): void {
    const sub = this.subs.get(subscriptionId)
    if (sub === undefined || !sub.active || sub.buffer.length === 0) return
    const take = sub.buffer.splice(0, this.cfg.flushMax)
    const dropped = sub.droppedSince
    sub.droppedSince = 0
    this.deps.push(subscriptionId, this.toBatch(take, dropped))
  }

  private toBatch(messages: readonly StreamMessage[], droppedSince: number): StreamBatch {
    return {
      columns: STREAM_COLUMNS,
      rows: messages.map((m) => [
        m.timestamp === null ? wire.null() : wire.int(m.timestamp),
        m.key === null ? wire.null() : wire.str(m.key),
        wire.str(m.value),
        wire.json(JSON.stringify(m.meta)),
      ]),
      droppedSince,
    }
  }

  async unsubscribe(subscriptionId: string): Promise<void> {
    const sub = this.subs.get(subscriptionId)
    if (sub === undefined) return
    sub.active = false
    if (sub.timer !== null) this.deps.clock.clearTimeout(sub.timer)
    this.subs.delete(subscriptionId)
    await sub.handle.stop()
  }

  async closeConnection(connectionId: string): Promise<void> {
    const ids = [...this.subs.entries()]
      .filter(([, s]) => s.connectionId === connectionId)
      .map(([id]) => id)
    await Promise.all(ids.map((id) => this.unsubscribe(id)))
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.subs.keys()].map((id) => this.unsubscribe(id)))
  }
}
