import type { ConnectionConfig } from '@shared/types/connection'

export type KafkaSaslMechanism = 'plain' | 'scram-sha-256' | 'scram-sha-512'

export interface KafkaConnParams {
  readonly clientId: string
  readonly brokers: readonly string[]
  readonly ssl: boolean
  readonly sasl?: {
    readonly mechanism: KafkaSaslMechanism
    readonly username: string
    readonly password: string
  }
}

const MECHANISMS: readonly KafkaSaslMechanism[] = ['plain', 'scram-sha-256', 'scram-sha-512']

/** config.database를 SASL mechanism으로 해석한다. 빈/미지원은 plain(fail-safe). */
export function parseSaslMechanism(database: string): KafkaSaslMechanism {
  const m = database.trim().toLowerCase()
  return (MECHANISMS as readonly string[]).includes(m) ? (m as KafkaSaslMechanism) : 'plain'
}

/**
 * ConnectionConfig를 kafkajs 연결 파라미터로 옮긴다(순수).
 *
 * host=쉼표구분 브로커 목록, database=SASL mechanism(SQLite database=파일경로 선례),
 * username 있으면 SASL(빈이면 no-auth), tlsMode !== disable이면 ssl. password는
 * SecretStore에서 오며 없으면 ''(kafkajs SASL은 password 키를 요구).
 */
export function buildKafkaConfig(config: ConnectionConfig, password: string | null): KafkaConnParams {
  const brokers = config.host.split(',').map((s) => s.trim()).filter((s) => s !== '')
  const ssl = config.tlsMode !== 'disable'
  return {
    clientId: `datacon-${config.id}`,
    brokers,
    ssl,
    // exactOptionalPropertyTypes: username이 실제로 있을 때만 sasl 키를 넣는다.
    ...(config.username !== ''
      ? {
          sasl: {
            mechanism: parseSaslMechanism(config.database),
            username: config.username,
            password: password ?? '',
          },
        }
      : {}),
  }
}
