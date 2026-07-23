import type { DriverRegistry } from '../core/driver/DriverRegistry'
import type { SecretRef, SecretStore } from '../core/ports/SecretStore'
import { createPostgresDriver } from '../drivers/postgres'
import { createSqliteDriver } from '../drivers/sqlite'
import { createMysqlDriver } from '../drivers/mysql'
import { createMongoDriver } from '../drivers/mongo'
import { createRedisDriver } from '../drivers/redis'

export interface RegisterDriversDeps {
  readonly secrets: Pick<SecretStore, 'get'>
}

/**
 * DriverRegistry에 구현된 엔진 드라이버를 등록한다. index.ts 부트스트랩에서 추출해
 * 테스트 가능하게 만든 것 — `registerDrivers.test.ts`가 등록 집합이
 * `IMPLEMENTED_ENGINE_IDS`와 일치함을 강제한다(공유 상수 ↔ 실제 배선 드리프트 가드).
 */
export function registerDrivers(registry: DriverRegistry, deps: RegisterDriversDeps): void {
  const passwordFor = (id: string): (() => Promise<string | null>) => {
    const ref: SecretRef = { kind: 'db-password', ownerId: id }
    return () => deps.secrets.get(ref)
  }
  registry.register('postgres', (config) => createPostgresDriver(config, { getPassword: passwordFor(config.id) }))
  registry.register('sqlite', (config) => createSqliteDriver(config))
  registry.register('mysql', (config) => createMysqlDriver(config, { getPassword: passwordFor(config.id) }))
  registry.register('mariadb', (config) => createMysqlDriver(config, { getPassword: passwordFor(config.id) }))
  registry.register('mongodb', (config) => createMongoDriver(config, { getPassword: passwordFor(config.id) }))
  registry.register('redis', (config) => createRedisDriver(config, { getPassword: passwordFor(config.id) }))
}
