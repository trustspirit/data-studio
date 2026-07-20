import type { ConnectionConfig } from '../../../shared/types/connection'
import { PostgresDriver, type PostgresDriverDeps } from './PostgresDriver'

export { PostgresDriver, ConnectionIdentityError } from './PostgresDriver'
export type { PostgresDriverDeps, PgConnParams, PgClientLike } from './PostgresDriver'

export function createPostgresDriver(
  config: ConnectionConfig,
  deps: PostgresDriverDeps,
): PostgresDriver {
  return new PostgresDriver(config, deps)
}
