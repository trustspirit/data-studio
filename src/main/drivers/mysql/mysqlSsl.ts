import type { TlsMode } from '@shared/types/connection'

export interface MysqlSslOptions {
  readonly rejectUnauthorized?: boolean
  readonly servername?: string
  readonly checkServerIdentity?: () => undefined
}

/**
 * tlsMode → mysql2 `ssl` 옵션. libpq sslmode 의미론을 따르며 `pgSsl.ts`와 동일하다.
 * verify-full을 require로 강등하지 않는다.
 */
export function mysqlSslConfig(tlsMode: TlsMode, host: string): false | MysqlSslOptions {
  switch (tlsMode) {
    case 'disable':
      return false
    case 'require':
      return { rejectUnauthorized: false }
    case 'verify-ca':
      return { rejectUnauthorized: true, checkServerIdentity: () => undefined }
    case 'verify-full':
      return { rejectUnauthorized: true, servername: host }
  }
}
