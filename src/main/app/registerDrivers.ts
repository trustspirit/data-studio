import type { DriverRegistry } from '../core/driver/DriverRegistry'
import type { SecretRef, SecretStore } from '../core/ports/SecretStore'
import { parseConnectionId } from '../core/connection/aiConnectionId'
import { createPostgresDriver } from '../drivers/postgres'
import { createSqliteDriver } from '../drivers/sqlite'
import { createMysqlDriver } from '../drivers/mysql'
import { createMongoDriver } from '../drivers/mongo'
import { createRedisDriver } from '../drivers/redis'
import { createKafkaDriver } from '../drivers/kafka'
import { createRabbitDriver } from '../drivers/rabbitmq'
import { createDynamoDriver } from '../drivers/dynamo'

export interface RegisterDriversDeps {
  readonly secrets: Pick<SecretStore, 'get'>
}

/**
 * 커넥션 id에 대응하는 DB 비밀번호 SecretRef.
 *
 * AI 파생 커넥션(`{baseId}::ai`)은 같은 커넥션의 두 번째 계정이다 — 비밀 종류만
 * 다르고 ownerId는 원 커넥션 id를 쓴다(renderer의 저장도 그 키로 된다).
 */
export function dbPasswordRefFor(connectionId: string): SecretRef {
  const { baseId, isAi } = parseConnectionId(connectionId)
  return { kind: isAi ? 'db-password-ai-readonly' : 'db-password', ownerId: baseId }
}

/**
 * DriverRegistry에 구현된 엔진 드라이버를 등록한다. index.ts 부트스트랩에서 추출해
 * 테스트 가능하게 만든 것 — `registerDrivers.test.ts`가 등록 집합이
 * `IMPLEMENTED_ENGINE_IDS`와 일치함을 강제한다(공유 상수 ↔ 실제 배선 드리프트 가드).
 */
export function registerDrivers(registry: DriverRegistry, deps: RegisterDriversDeps): void {
  const passwordFor = (id: string): (() => Promise<string | null>) => {
    const ref = dbPasswordRefFor(id)
    return () => deps.secrets.get(ref)
  }
  registry.register('postgres', (config) => createPostgresDriver(config, { getPassword: passwordFor(config.id) }))
  registry.register('sqlite', (config) => createSqliteDriver(config))
  registry.register('mysql', (config) => createMysqlDriver(config, { getPassword: passwordFor(config.id) }))
  registry.register('mariadb', (config) => createMysqlDriver(config, { getPassword: passwordFor(config.id) }))
  registry.register('mongodb', (config) => createMongoDriver(config, { getPassword: passwordFor(config.id) }))
  registry.register('redis', (config) => createRedisDriver(config, { getPassword: passwordFor(config.id) }))
  registry.register('kafka', (config) => createKafkaDriver(config, { getPassword: passwordFor(config.id) }))
  registry.register('rabbitmq', (config) => createRabbitDriver(config, { getPassword: passwordFor(config.id) }))
  registry.register('dynamodb', (config) => createDynamoDriver(config, { getPassword: passwordFor(config.id) }))
}
