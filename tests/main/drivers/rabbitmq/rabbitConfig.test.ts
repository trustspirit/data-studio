import { describe, it, expect } from 'vitest'
import { buildRabbitConfig } from '@main/drivers/rabbitmq/rabbitConfig'
import type { ConnectionConfig } from '@shared/types/connection'

function cfg(over: Partial<ConnectionConfig> = {}): ConnectionConfig {
  return {
    id: 'conn-1', name: 'test', engine: 'rabbitmq',
    host: 'localhost', port: 5672, database: '', username: 'guest',
    tlsMode: 'disable', aiReadOnlyUsername: null, maskedColumnPatterns: [],
    ...over,
  }
}

describe('buildRabbitConfig', () => {
  it('기본 amqp 옵션(비TLS)', () => {
    const p = buildRabbitConfig(cfg(), 'guest')
    expect(p.amqp).toEqual({ protocol: 'amqp', hostname: 'localhost', port: 5672, username: 'guest', password: 'guest', vhost: '/' })
  })
  it('database가 vhost, 빈 값은 /', () => {
    expect(buildRabbitConfig(cfg({ database: 'myvhost' }), null).amqp.vhost).toBe('myvhost')
    expect(buildRabbitConfig(cfg({ database: '' }), null).amqp.vhost).toBe('/')
  })
  it('password null은 빈 문자열', () => {
    expect(buildRabbitConfig(cfg(), null).amqp.password).toBe('')
  })
  it('tlsMode !== disable면 amqps + https:15671', () => {
    const p = buildRabbitConfig(cfg({ tlsMode: 'require' }), 'pw')
    expect(p.amqp.protocol).toBe('amqps')
    expect(p.mgmt.url).toBe('https://localhost:15671')
  })
  it('비TLS는 http:15672', () => {
    expect(buildRabbitConfig(cfg(), 'pw').mgmt.url).toBe('http://localhost:15672')
  })
  it('mgmt auth는 base64(user:pass)', () => {
    const p = buildRabbitConfig(cfg({ username: 'u' }), 'p')
    expect(p.mgmt.auth).toBe(Buffer.from('u:p').toString('base64'))
  })
})
