import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import type { ConnectionConfig } from '@shared/types/connection'
import { createSqliteDriver } from '@main/drivers/sqlite'

let dir: string
let dbPath: string

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'datacon-sqlite-drv-'))
  dbPath = join(dir, 'drv.db')
  const seed = new Database(dbPath)
  seed.exec('CREATE TABLE t (id integer primary key)')
  seed.close()
})
afterAll(() => rmSync(dir, { recursive: true, force: true }))

function cfg(id = 'drv-1', database = dbPath): ConnectionConfig {
  return {
    id,
    name: 'sqlite',
    engine: 'sqlite',
    host: '',
    port: 0,
    database,
    username: '',
    tlsMode: 'disable',
    aiReadOnlyUsername: null,
    maskedColumnPatterns: [],
  }
}

describe('SqliteDriver', () => {
  it('id와 engine을 노출한다', () => {
    const d = createSqliteDriver(cfg())
    expect(d.id).toBe('drv-1')
    expect(d.engine).toBe('sqlite')
  })

  it('connect 이후 ping이 음이 아닌 수치를 준다', async () => {
    const d = createSqliteDriver(cfg())
    await d.connect(cfg())
    await expect(d.ping()).resolves.toBeGreaterThanOrEqual(0)
    await d.disconnect()
  })

  it('id가 다른 config로 connect하면 거부한다', async () => {
    const d = createSqliteDriver(cfg('drv-1'))
    await expect(d.connect(cfg('drv-2'))).rejects.toThrow()
  })

  it('없는 파일 경로는 connect가 거부한다', async () => {
    const missing = join(dir, 'nope.db')
    const d = createSqliteDriver(cfg('drv-1', missing))
    await expect(d.connect(cfg('drv-1', missing))).rejects.toThrow()
  })

  it('disconnect 이후 ping은 거부된다', async () => {
    const d = createSqliteDriver(cfg())
    await d.connect(cfg())
    await d.disconnect()
    await expect(d.ping()).rejects.toThrow()
  })

  it('disconnect는 두 번 불러도 던지지 않는다', async () => {
    const d = createSqliteDriver(cfg())
    await d.connect(cfg())
    await d.disconnect()
    await expect(d.disconnect()).resolves.toBeUndefined()
  })
})
