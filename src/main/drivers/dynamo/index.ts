import type { ConnectionConfig } from '@shared/types/connection'
import { DynamoDriver, type DynamoDriverDeps } from './DynamoDriver'

export { DynamoDriver, DynamoConnectionIdentityError } from './DynamoDriver'
export type { DynamoDriverDeps, DynamoClientLike } from './DynamoDriver'

export function createDynamoDriver(config: ConnectionConfig, deps: DynamoDriverDeps): DynamoDriver {
  return new DynamoDriver(config, deps)
}
