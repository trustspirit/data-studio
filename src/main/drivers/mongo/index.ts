import type { ConnectionConfig } from '@shared/types/connection'
import { MongoDriver, type MongoDriverDeps } from './MongoDriver'

export { MongoDriver, MongoConnectionIdentityError } from './MongoDriver'
export type { MongoDriverDeps, MongoConnParams, MongoClientLike, MongoDbLike } from './MongoDriver'

export function createMongoDriver(config: ConnectionConfig, deps: MongoDriverDeps): MongoDriver {
  return new MongoDriver(config, deps)
}
