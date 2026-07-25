import type { ConnectionConfig } from '@shared/types/connection'

export interface DynamoStaticCreds {
  readonly accessKeyId: string
  readonly secretAccessKey: string
}

export interface DynamoConnParams {
  readonly region: string
  /** 비우면 SDK 기본 엔드포인트(실 AWS). 채우면 오버라이드(DynamoDB Local 또는 자체 호스팅). */
  readonly endpoint?: string
  /** username이 비면 생략 → 호출부가 fromNodeProviderChain을 쓴다. */
  readonly credentials?: DynamoStaticCreds
}

/**
 * ConnectionConfig의 고정 필드를 DynamoDB 연결 파라미터로 재해석한다(순수 함수).
 *
 * - region = database (빈 문자열이면 그대로 — SDK가 리전 없음으로 실패하게 둔다;
 *   잘못된 리전을 침묵으로 지어내지 않는다).
 * - endpoint = host가 비면 생략(실 AWS), 아니면 `{scheme}://host:port`. scheme은
 *   tlsMode를 따른다 — 'disable'만 http이고 나머지 세 등급은 전부 https.
 * - credentials = username이 비면 생략(provider chain 위임), 아니면 정적 키.
 *
 * 엔드포인트 오버라이드가 tlsMode와 무관하게 http로 고정돼 있던 적이 있다.
 * SigV4는 서명만 하지 암호화하지 않으므로 그 상태에서는 요청·응답 본문과
 * accessKeyId가 평문으로 흐르고, provider chain 경로(SSO/EC2/ECS 역할)에서는
 * 임시 자격증명의 X-Amz-Security-Token 헤더까지 같이 흐른다 — 그 토큰 하나면
 * 계정 권한을 만료 전까지 그대로 재사용할 수 있다. 반대로 https로 못 박으면
 * DynamoDB Local을 못 쓴다. 그래서 사용자가 이미 고른 값(tlsMode)에 스킴을 건다.
 *
 * 'require'/'verify-ca'를 pgSsl.ts처럼 검증 완화로 옮기지는 않는다. AWS SDK에서
 * 그걸 하려면 https.Agent를 단 커스텀 requestHandler를 끼워야 하는데, 그 배선의
 * 대가로 얻는 것이 "자체 서명 인증서를 쓰는 DynamoDB 호환 엔드포인트" 하나뿐이다.
 * 세 등급 모두 Node TLS 기본값(체인+호스트명 검증)으로 보낸다 — 사용자가 고른
 * 것보다 강한 쪽이라, 틀리더라도 안전한 방향으로 틀린다.
 */
export function buildDynamoConfig(config: ConnectionConfig, secret: string | null): DynamoConnParams {
  const scheme = config.tlsMode === 'disable' ? 'http' : 'https'
  return {
    region: config.database,
    ...(config.host === '' ? {} : { endpoint: `${scheme}://${config.host}:${config.port}` }),
    ...(config.username === ''
      ? {}
      : { credentials: { accessKeyId: config.username, secretAccessKey: secret ?? '' } }),
  }
}
