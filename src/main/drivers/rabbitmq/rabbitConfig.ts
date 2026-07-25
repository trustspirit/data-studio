import type { ConnectionConfig } from '@shared/types/connection'

export interface RabbitAmqpParams {
  readonly protocol: 'amqp' | 'amqps'
  readonly hostname: string
  readonly port: number
  readonly username: string
  readonly password: string
  readonly vhost: string
}

export interface RabbitMgmtParams {
  readonly url: string // http(s)://host:1567x
  readonly auth: string // base64("user:pass")
}

export interface RabbitConnParams {
  readonly amqp: RabbitAmqpParams
  readonly mgmt: RabbitMgmtParams
}

/**
 * ConnectionConfig를 RabbitMQ 연결 파라미터로 옮긴다(순수).
 *
 * AMQP(5672)와 관리 HTTP API(15672)는 별개 엔드포인트다 — 관리 API가 없으면
 * exchange를 열거할 수 없어 listTopics가 불가능하다. database=vhost(빈→'/'),
 * tlsMode→amqps+https(15671), 같은 자격증명으로 AMQP auth와 mgmt basic auth 양쪽.
 */
export function buildRabbitConfig(config: ConnectionConfig, password: string | null): RabbitConnParams {
  const tls = config.tlsMode !== 'disable'
  const pw = password ?? ''
  const vhost = config.database === '' ? '/' : config.database
  const scheme = tls ? 'https' : 'http'
  const mgmtPort = tls ? 15671 : 15672
  return {
    amqp: {
      protocol: tls ? 'amqps' : 'amqp',
      hostname: config.host,
      port: config.port,
      username: config.username,
      password: pw,
      vhost,
    },
    mgmt: {
      url: `${scheme}://${config.host}:${mgmtPort}`,
      auth: Buffer.from(`${config.username}:${pw}`).toString('base64'),
    },
  }
}
