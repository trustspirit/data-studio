import type { ConnectionConfig } from '@shared/types/connection'
import { KafkaDriver, type KafkaDriverDeps } from './KafkaDriver'

export { KafkaDriver, KafkaConnectionIdentityError } from './KafkaDriver'
export type { KafkaDriverDeps, KafkaClientLike, KafkaAdminLike, KafkaConsumerLike, KafkaMessageLike, EachMessagePayloadLike } from './KafkaDriver'

export function createKafkaDriver(config: ConnectionConfig, deps: KafkaDriverDeps): KafkaDriver {
  return new KafkaDriver(config, deps)
}
