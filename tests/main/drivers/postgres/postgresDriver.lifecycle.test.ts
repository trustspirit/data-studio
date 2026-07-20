import { describe, expect, it } from 'vitest'
import type { ConnectionConfig } from '@shared/types/connection'
import { createPostgresDriver } from '@main/drivers/postgres'
import { PG_AVAILABLE, TEST_DB_URL } from '../../../contract/pgTestEnv'

function configFromUrl(url: string): ConnectionConfig {
  const u = new URL(url)
  return {
    id: 'pg-life-1',
    name: 'pg',
    engine: 'postgres',
    host: u.hostname,
    port: Number(u.port),
    database: u.pathname.slice(1),
    username: decodeURIComponent(u.username),
    tlsMode: 'disable',
    aiReadOnlyUsername: null,
    maskedColumnPatterns: [],
  }
}

describe.skipIf(!PG_AVAILABLE)('PostgresDriver 수명주기 (실제 pg 필요)', () => {
  const url = new URL(TEST_DB_URL)
  const password = decodeURIComponent(url.password)

  function makeDriver() {
    return createPostgresDriver(configFromUrl(TEST_DB_URL), {
      getPassword: () => Promise.resolve(password),
    })
  }

  it('connect 후 ping이 왕복 지연을 돌려준다', async () => {
    const driver = makeDriver()
    await driver.connect(configFromUrl(TEST_DB_URL))
    try {
      const ms = await driver.ping()
      expect(ms).toBeGreaterThanOrEqual(0)
    } finally {
      await driver.disconnect()
    }
  })

  it('connect가 config.id와 driver.id 불일치를 거부한다', async () => {
    const driver = makeDriver()
    const wrong = { ...configFromUrl(TEST_DB_URL), id: 'other' }
    await expect(driver.connect(wrong)).rejects.toThrow()
  })

  it('disconnect 후 ping은 실패한다', async () => {
    const driver = makeDriver()
    await driver.connect(configFromUrl(TEST_DB_URL))
    await driver.disconnect()
    await expect(driver.ping()).rejects.toThrow()
  })

  it('getPassword가 null이면 비밀번호 없이 접속을 시도한다 (board는 비번 필요 → 실패)', async () => {
    const driver = createPostgresDriver(configFromUrl(TEST_DB_URL), {
      getPassword: () => Promise.resolve(null),
    })
    // 비밀번호 없이는 scram 서버가 거부한다 — getPassword 결과가 실제로 쓰인다는 증거.
    await expect(driver.connect(configFromUrl(TEST_DB_URL))).rejects.toThrow()
  })
})
