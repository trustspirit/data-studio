import { describe, expect, it } from 'vitest'
import { PG_AVAILABLE } from './pgTestEnv'
import { MYSQL_AVAILABLE, MARIADB_AVAILABLE } from './mysqlTestEnv'
import { MONGO_AVAILABLE } from './mongoTestEnv'
import { REDIS_AVAILABLE } from './redisTestEnv'
import { KAFKA_AVAILABLE } from './kafkaTestEnv'
import { RABBIT_AVAILABLE } from './rabbitTestEnv'
import { DYNAMO_AVAILABLE } from './dynamoTestEnv'

describe.runIf(process.env['DATACON_REQUIRE_ENGINES'] === '1')('필수 통합 테스트 서버', () => {
  it.each([
    ['PostgreSQL', PG_AVAILABLE], ['MySQL', MYSQL_AVAILABLE], ['MariaDB', MARIADB_AVAILABLE],
    ['MongoDB', MONGO_AVAILABLE], ['Redis', REDIS_AVAILABLE], ['Kafka', KAFKA_AVAILABLE],
    ['RabbitMQ', RABBIT_AVAILABLE], ['DynamoDB', DYNAMO_AVAILABLE],
  ])('%s 서버가 준비되어 있다', (_engine, available) => {
    expect(available, 'docker compose -f docker-compose.test.yml up -d 로 테스트 서버를 먼저 시작하세요.').toBe(true)
  })
})
