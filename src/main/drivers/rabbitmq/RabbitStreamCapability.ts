import type { PageRequest, ResultSet } from '@shared/types/resultSet'
import type { ExecutionContext } from '@main/core/driver/ExecutionContext'
import type {
  StreamCapability, StreamHandle, StreamMessageSink, StreamSubscribeReq,
} from '@main/core/driver/capabilities/StreamCapability'
import type { AmqpChannelLike, AmqpConnectionLike } from './RabbitDriver'
import type { RabbitMgmtParams } from './rabbitConfig'

export interface RabbitStreamDeps {
  readonly getConnection: () => AmqpConnectionLike
  readonly getMgmt: () => RabbitMgmtParams
  readonly getVhost: () => string
  readonly httpGetJson: (url: string, auth: string) => Promise<unknown>
  readonly trackChannel: (c: AmqpChannelLike) => void
  readonly untrackChannel: (c: AmqpChannelLike) => void
}

/** Task 3에서 listTopics/subscribe를 구현한다. 지금은 골격만. */
export class RabbitStreamCapability implements StreamCapability {
  constructor(private readonly deps: RabbitStreamDeps) {}

  listTopics(_ctx: ExecutionContext, _page: PageRequest): Promise<ResultSet> {
    void this.deps
    return Promise.reject(new Error('not implemented'))
  }

  subscribe(_ctx: ExecutionContext, _req: StreamSubscribeReq, _sink: StreamMessageSink): Promise<StreamHandle> {
    return Promise.reject(new Error('not implemented'))
  }
}
