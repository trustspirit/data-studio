import { describe, it, expect } from 'vitest'
import { TLS_MODES, type ConnectionConfig } from '@shared/types/connection'
import { buildDynamoConfig } from '@main/drivers/dynamo/dynamoConfig'

function cfg(over: Partial<ConnectionConfig>): ConnectionConfig {
  return {
    id: 'c1', name: 'n', engine: 'dynamodb', host: '', port: 8000,
    database: 'us-east-1', username: '', tlsMode: 'disable',
    aiReadOnlyUsername: null, maskedColumnPatterns: [], ...over,
  }
}

describe('buildDynamoConfig', () => {
  it('region은 database에서 온다', () => {
    expect(buildDynamoConfig(cfg({ database: 'ap-northeast-2' }), null).region).toBe('ap-northeast-2')
  })

  it('host가 비면 endpoint를 생략한다(실 AWS)', () => {
    expect('endpoint' in buildDynamoConfig(cfg({ host: '' }), null)).toBe(false)
  })

  it('tlsMode disable이면 http://host:port로 endpoint를 만든다(DynamoDB Local)', () => {
    const p = buildDynamoConfig(cfg({ host: 'localhost', port: 8000, tlsMode: 'disable' }), null)
    expect(p.endpoint).toBe('http://localhost:8000')
  })

  it.each(['require', 'verify-ca', 'verify-full'] as const)(
    'tlsMode %s면 endpoint 스킴이 https다',
    (tlsMode) => {
      const p = buildDynamoConfig(cfg({ host: 'dynamo.internal', port: 443, tlsMode }), null)
      expect(p.endpoint).toBe('https://dynamo.internal:443')
    },
  )

  it('disable이 아닌 모드가 평문 http로 새지 않는다', () => {
    // SigV4는 서명만 하고 암호화하지 않는다. 여기서 http가 하나라도 새면
    // accessKeyId와 (provider chain 경로에서는) 세션 토큰이 평문으로 나간다.
    for (const tlsMode of TLS_MODES.filter((m) => m !== 'disable')) {
      const p = buildDynamoConfig(cfg({ host: 'dynamo.internal', tlsMode }), null)
      expect(p.endpoint?.startsWith('https://')).toBe(true)
    }
  })

  it('host가 비면 tlsMode와 무관하게 endpoint를 만들지 않는다', () => {
    for (const tlsMode of TLS_MODES) {
      expect('endpoint' in buildDynamoConfig(cfg({ host: '', tlsMode }), null)).toBe(false)
    }
  })

  it('username이 있으면 정적 자격증명, secret null은 빈 문자열', () => {
    const p = buildDynamoConfig(cfg({ username: 'AKIA' }), null)
    expect(p.credentials).toEqual({ accessKeyId: 'AKIA', secretAccessKey: '' })
  })

  it('username이 있으면 secret을 secretAccessKey로 쓴다', () => {
    expect(buildDynamoConfig(cfg({ username: 'AKIA' }), 's3cr3t').credentials?.secretAccessKey).toBe('s3cr3t')
  })

  it('username이 비면 credentials를 생략한다(provider chain 위임)', () => {
    expect('credentials' in buildDynamoConfig(cfg({ username: '' }), 'ignored')).toBe(false)
  })
})
