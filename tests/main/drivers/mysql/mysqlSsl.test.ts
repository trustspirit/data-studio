import { describe, expect, it } from 'vitest'
import { mysqlSslConfig } from '@main/drivers/mysql/mysqlSsl'

describe('mysqlSslConfig', () => {
  it('disable → false (평문)', () => {
    expect(mysqlSslConfig('disable', 'db.example.com')).toBe(false)
  })

  it('require → 암호화하되 신원검사 없음', () => {
    expect(mysqlSslConfig('require', 'db.example.com')).toEqual({ rejectUnauthorized: false })
  })

  it('verify-ca → 체인 검증, 호스트명 검사 없음', () => {
    const cfg = mysqlSslConfig('verify-ca', 'db.example.com')
    expect(cfg).toMatchObject({ rejectUnauthorized: true })
    if (cfg === false) throw new Error('expected object')
    expect(cfg.checkServerIdentity?.()).toBeUndefined()
    expect(cfg.servername).toBeUndefined()
  })

  it('verify-full → 체인+호스트명 검증', () => {
    expect(mysqlSslConfig('verify-full', 'db.example.com')).toEqual({
      rejectUnauthorized: true,
      servername: 'db.example.com',
    })
  })
})
