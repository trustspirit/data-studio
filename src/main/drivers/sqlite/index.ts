import type { ConnectionConfig } from '../../../shared/types/connection'
import { SqliteDriver } from './SqliteDriver'

export { SqliteDriver, SqliteConnectionIdentityError } from './SqliteDriver'
export type { DatabaseInstance } from './SqliteDriver'

export function createSqliteDriver(config: ConnectionConfig): SqliteDriver {
  return new SqliteDriver(config)
}
