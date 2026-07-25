import type { ConnectionConfig } from '@shared/types/connection'

export interface DynamoStaticCreds {
  readonly accessKeyId: string
  readonly secretAccessKey: string
}

export interface DynamoConnParams {
  readonly region: string
  /** 비우면 SDK 기본 엔드포인트(실 AWS). 채우면 오버라이드(DynamoDB Local). */
  readonly endpoint?: string
  /** username이 비면 생략 → 호출부가 fromNodeProviderChain을 쓴다. */
  readonly credentials?: DynamoStaticCreds
}

/**
 * ConnectionConfig의 고정 필드를 DynamoDB 연결 파라미터로 재해석한다(순수 함수).
 *
 * - region = database (빈 문자열이면 그대로 — SDK가 리전 없음으로 실패하게 둔다;
 *   잘못된 리전을 침묵으로 지어내지 않는다).
 * - endpoint = host가 비면 생략(실 AWS), 아니면 http://host:port (DynamoDB Local).
 * - credentials = username이 비면 생략(provider chain 위임), 아니면 정적 키.
 */
export function buildDynamoConfig(config: ConnectionConfig, secret: string | null): DynamoConnParams {
  return {
    region: config.database,
    ...(config.host === '' ? {} : { endpoint: `http://${config.host}:${config.port}` }),
    ...(config.username === ''
      ? {}
      : { credentials: { accessKeyId: config.username, secretAccessKey: secret ?? '' } }),
  }
}
