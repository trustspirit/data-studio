import type { TlsMode } from '../../../shared/types/connection'

export interface PgSslOptions {
  readonly rejectUnauthorized: boolean
  readonly checkServerIdentity?: (host: string, cert: unknown) => Error | undefined
  readonly servername?: string
}

/**
 * tlsMode를 pg의 ssl 설정으로 옮긴다. libpq sslmode 의미를 따른다:
 * - disable: 평문.
 * - require: 암호화하되 서버 신원 미검증(사용자가 명시 선택한 등급).
 * - verify-ca: 인증서 체인은 검증, 호스트명은 검증 안 함.
 * - verify-full: 체인 + 호스트명 검증(Node 기본 checkServerIdentity).
 *
 * verify-full을 require로 몰래 강등하지 않는다 — 검증 등급은 사용자 선택 그대로다.
 */
export function pgSslConfig(tlsMode: TlsMode, host: string): false | PgSslOptions {
  switch (tlsMode) {
    case 'disable':
      return false
    case 'require':
      return { rejectUnauthorized: false }
    case 'verify-ca':
      // 체인은 검증(rejectUnauthorized), 호스트명 검증만 끈다.
      return { rejectUnauthorized: true, checkServerIdentity: () => undefined }
    case 'verify-full':
      // 오버라이드 없음 → Node가 체인 + 호스트명을 검증한다.
      return { rejectUnauthorized: true, servername: host }
  }
}
