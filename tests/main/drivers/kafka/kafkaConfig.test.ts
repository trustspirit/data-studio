import { describe, it, expect } from 'vitest'
import { parseSaslMechanism, buildKafkaConfig } from '@main/drivers/kafka/kafkaConfig'
import type { ConnectionConfig } from '@shared/types/connection'

function cfg(over: Partial<ConnectionConfig> = {}): ConnectionConfig {
  return {
    id: 'conn-1', name: 'test', engine: 'kafka',
    host: 'localhost:9092', port: 9092, database: '', username: '',
    tlsMode: 'disable', aiReadOnlyUsername: null, maskedColumnPatterns: [],
    ...over,
  }
}

describe('parseSaslMechanism', () => {
  it('알려진 mechanism을 통과시킨다', () => {
    expect(parseSaslMechanism('plain')).toBe('plain')
    expect(parseSaslMechanism('scram-sha-256')).toBe('scram-sha-256')
    expect(parseSaslMechanism('SCRAM-SHA-512')).toBe('scram-sha-512')
  })
  it('빈/미지원은 plain으로 fallback', () => {
    expect(parseSaslMechanism('')).toBe('plain')
    expect(parseSaslMechanism('nope')).toBe('plain')
  })
})

describe('buildKafkaConfig', () => {
  it('host를 쉼표 브로커 목록으로 파싱(trim/빈 제거)', () => {
    const p = buildKafkaConfig(cfg({ host: ' b1:9092 , b2:9092 ,' }), null)
    expect(p.brokers).toEqual(['b1:9092', 'b2:9092'])
  })
  it('tlsMode !== disable면 ssl true', () => {
    expect(buildKafkaConfig(cfg({ tlsMode: 'require' }), null).ssl).toBe(true)
    expect(buildKafkaConfig(cfg({ tlsMode: 'disable' }), null).ssl).toBe(false)
  })
  it('username 없으면 sasl 생략', () => {
    expect(buildKafkaConfig(cfg({ username: '' }), 'pw').sasl).toBeUndefined()
  })
  it('username 있으면 database를 mechanism으로, password 반영', () => {
    const p = buildKafkaConfig(cfg({ username: 'u', database: 'scram-sha-256' }), 'pw')
    expect(p.sasl).toEqual({ mechanism: 'scram-sha-256', username: 'u', password: 'pw' })
  })
  it('password null이면 빈 문자열', () => {
    const p = buildKafkaConfig(cfg({ username: 'u' }), null)
    expect(p.sasl?.password).toBe('')
    expect(p.sasl?.mechanism).toBe('plain')
  })
  it('clientId는 datacon-<id>', () => {
    expect(buildKafkaConfig(cfg({ id: 'abc' }), null).clientId).toBe('datacon-abc')
  })
})
