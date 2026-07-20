import { describe, expect, it } from 'vitest'
import { pgSslConfig } from '@main/drivers/postgres/pgSsl'

describe('pgSslConfig', () => {
  it('disable은 ssl을 끈다', () => {
    expect(pgSslConfig('disable', 'db.local')).toBe(false)
  })

  it('require는 암호화만 (인증서 미검증) — libpq sslmode=require 의미', () => {
    // 의도된 트레이드오프: 사용자가 명시 선택한 등급을 반영한다.
    expect(pgSslConfig('require', 'db.local')).toEqual({ rejectUnauthorized: false })
  })

  it('verify-ca는 체인은 검증하되 호스트명은 검증하지 않는다', () => {
    const cfg = pgSslConfig('verify-ca', 'db.local')
    expect(cfg).not.toBe(false)
    if (cfg === false) return
    expect(cfg.rejectUnauthorized).toBe(true)
    // checkServerIdentity 오버라이드가 실제로 존재해야 한다 — optional chaining으로
    // 부재(undefined)와 "항상 undefined 반환"을 혼동하지 않도록 존재를 먼저 확인한다.
    expect(typeof cfg.checkServerIdentity).toBe('function')
    expect(cfg.checkServerIdentity!('any', {})).toBeUndefined()
  })

  it('verify-full은 체인과 호스트명을 모두 검증한다 (checkServerIdentity 오버라이드 없음)', () => {
    const cfg = pgSslConfig('verify-full', 'db.local')
    expect(cfg).not.toBe(false)
    if (cfg === false) return
    expect(cfg.rejectUnauthorized).toBe(true)
    // 오버라이드가 없어야 Node 기본 호스트 검증이 작동한다.
    expect(cfg.checkServerIdentity).toBeUndefined()
    expect(cfg.servername).toBe('db.local')
  })
})
