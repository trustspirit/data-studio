import type { PageRequest, ResultSet } from '@shared/types/resultSet'
import type { ExecutionContext } from '@main/core/driver/ExecutionContext'
import type {
  StreamCapability, StreamHandle, StreamMessageSink, StreamSubscribeReq,
} from '@main/core/driver/capabilities/StreamCapability'
import type { KafkaAdminLike, KafkaConsumerLike } from './KafkaDriver'

export interface KafkaStreamDeps {
  readonly getAdmin: () => KafkaAdminLike
  readonly newConsumer: () => KafkaConsumerLike
  readonly nextGroupId: () => string
  readonly trackConsumer: (c: KafkaConsumerLike) => void
  readonly untrackConsumer: (c: KafkaConsumerLike) => void
}

/** Task 3에서 listTopics/subscribe를 구현한다. 지금은 골격만. */
export class KafkaStreamCapability implements StreamCapability {
  constructor(private readonly deps: KafkaStreamDeps) {}

  listTopics(_ctx: ExecutionContext, _page: PageRequest): Promise<ResultSet> {
    void this.deps
    return Promise.reject(new Error('not implemented'))
  }

  subscribe(_ctx: ExecutionContext, _req: StreamSubscribeReq, _sink: StreamMessageSink): Promise<StreamHandle> {
    return Promise.reject(new Error('not implemented'))
  }
}
