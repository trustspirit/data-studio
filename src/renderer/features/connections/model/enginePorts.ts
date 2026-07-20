import type { EngineId } from '@shared/types/connection'

/**
 * 엔진별 표준 기본 포트. `satisfies Record<EngineId, ...>`가 핵심 —
 * `ENGINE_IDS`에 엔진을 추가하면 이 표를 채우기 전까지 컴파일이 깨진다.
 * sqlite/dynamodb는 host:port 개념이 없어 null이다.
 */
export const DEFAULT_PORTS = {
  postgres: 5432,
  mysql: 3306,
  mariadb: 3306,
  mongodb: 27017,
  redis: 6379,
  kafka: 9092,
  rabbitmq: 5672,
  sqlite: null,
  dynamodb: null,
} as const satisfies Record<EngineId, number | null>

export function defaultPort(engine: EngineId): number | null {
  return DEFAULT_PORTS[engine]
}
