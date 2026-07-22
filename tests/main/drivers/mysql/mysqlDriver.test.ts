import { describe, it, expect } from 'vitest'
import { createMysqlDriver } from '@main/drivers/mysql'
import { MysqlConnectionIdentityError } from '@main/drivers/mysql/MysqlDriver'
import { MYSQL_AVAILABLE, MYSQL_URL } from '../../../contract/mysqlTestEnv'
import type { ConnectionConfig } from '@shared/types/connection'

function cfg(over: Partial<ConnectionConfig> = {}): ConnectionConfig {
  return {
    id: 'conn-1',
    name: 'test',
    engine: 'mysql',
    host: 'localhost',
    port: 3306,
    database: 'datacon_test',
    username: 'root',
    tlsMode: 'disable',
    aiReadOnlyUsername: null,
    maskedColumnPatterns: [],
    ...over,
  }
}

describe('MysqlDriver (fake client — 서버 불필요)', () => {
  it('id/engine을 노출한다', () => {
    const d = createMysqlDriver(cfg(), { getPassword: () => Promise.resolve(null) })
    expect(d.id).toBe('conn-1')
    expect(d.engine).toBe('mysql')
  })

  it('mariadb engine을 config에서 받는다', () => {
    const d = createMysqlDriver(cfg({ engine: 'mariadb' }), { getPassword: () => Promise.resolve(null) })
    expect(d.engine).toBe('mariadb')
  })

  it('config.id가 어긋나면 connect가 거부된다', async () => {
    const d = createMysqlDriver(cfg(), { getPassword: () => Promise.resolve(null) })
    await expect(d.connect(cfg({ id: 'other' }))).rejects.toThrow(MysqlConnectionIdentityError)
  })

  it('연결 전 disconnect는 안전(멱등)', async () => {
    const d = createMysqlDriver(cfg(), { getPassword: () => Promise.resolve(null) })
    await expect(d.disconnect()).resolves.toBeUndefined()
  })
})

describe.skipIf(!MYSQL_AVAILABLE)('MysqlDriver (실서버)', () => {
  const url = new URL(MYSQL_URL)
  const liveCfg = cfg({
    host: url.hostname,
    port: Number(url.port),
    database: url.pathname.slice(1),
    username: url.username,
  })
  const deps = { getPassword: () => Promise.resolve(decodeURIComponent(url.password)) }

  it('connect 후 ping이 유한한 ms를 준다', async () => {
    const d = createMysqlDriver(liveCfg, deps)
    await d.connect(liveCfg)
    const ms = await d.ping()
    expect(ms).toBeGreaterThanOrEqual(0)
    expect(Number.isFinite(ms)).toBe(true)
    await d.disconnect()
  })

  it('disconnect 후 ping은 거부된다', async () => {
    const d = createMysqlDriver(liveCfg, deps)
    await d.connect(liveCfg)
    await d.disconnect()
    await expect(d.ping()).rejects.toThrow()
  })

  it('disconnect는 두 번 불러도 안전', async () => {
    const d = createMysqlDriver(liveCfg, deps)
    await d.connect(liveCfg)
    await d.disconnect()
    await expect(d.disconnect()).resolves.toBeUndefined()
  })
})
