import type { ConnectionConfig } from '@shared/types/connection'
import { RedisDriver, type RedisDriverDeps } from './RedisDriver'

export { RedisDriver, RedisConnectionIdentityError } from './RedisDriver'
export type { RedisDriverDeps, RedisConnParams, RedisClientLike } from './RedisDriver'

export function createRedisDriver(config: ConnectionConfig, deps: RedisDriverDeps): RedisDriver {
  return new RedisDriver(config, deps)
}
