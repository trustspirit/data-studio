import type { ConnectionConfig } from '@shared/types/connection'
import { RabbitDriver, type RabbitDriverDeps } from './RabbitDriver'

export { RabbitDriver, RabbitConnectionIdentityError } from './RabbitDriver'
export type { RabbitDriverDeps, AmqpConnectionLike, AmqpChannelLike, AmqpMessageLike } from './RabbitDriver'

export function createRabbitDriver(config: ConnectionConfig, deps: RabbitDriverDeps): RabbitDriver {
  return new RabbitDriver(config, deps)
}
