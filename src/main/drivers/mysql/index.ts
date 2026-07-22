import type { ConnectionConfig } from '@shared/types/connection'
import { MysqlDriver, type MysqlDriverDeps } from './MysqlDriver'

export { MysqlDriver, MysqlConnectionIdentityError } from './MysqlDriver'
export type { MysqlDriverDeps, MysqlClientLike, MysqlConnParams } from './MysqlDriver'

export function createMysqlDriver(config: ConnectionConfig, deps: MysqlDriverDeps): MysqlDriver {
  return new MysqlDriver(config, deps)
}
