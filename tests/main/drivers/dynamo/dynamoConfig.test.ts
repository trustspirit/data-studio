import { describe, it, expect } from 'vitest'
import type { ConnectionConfig } from '@shared/types/connection'
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

  it('host가 있으면 http://host:port로 endpoint를 만든다', () => {
    expect(buildDynamoConfig(cfg({ host: 'localhost', port: 8000 }), null).endpoint).toBe('http://localhost:8000')
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
