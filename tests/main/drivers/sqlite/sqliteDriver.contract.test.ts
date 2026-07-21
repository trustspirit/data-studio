import { afterAll } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import Database from 'better-sqlite3'
import type { ConnectionConfig } from '@shared/types/connection'
import { createSqliteDriver } from '@main/drivers/sqlite'
import { describeDriverContract } from '../../../contract/driverContract'

// SQLite는 임베디드라 계약이 항상 실제로 돈다(skip 없음). 임시 파일 DB를 미리 시드한다.
const dir = mkdtempSync(join(tmpdir(), 'datacon-sqlite-contract-'))
const dbPath = join(dir, `contract-${randomUUID()}.db`)
{
  const seed = new Database(dbPath)
  seed.exec(
    'CREATE TABLE nums (id integer primary key); INSERT INTO nums VALUES (1),(2),(3),(4),(5);' +
      'CREATE TABLE other (id integer primary key); INSERT INTO other VALUES (10),(20),(30);' +
      'CREATE TABLE w (id integer primary key); INSERT INTO w VALUES (1),(2);',
  )
  seed.close()
}

function cfg(id = 'sqlite-contract-1'): ConnectionConfig {
  return {
    id,
    name: 'sqlite',
    engine: 'sqlite',
    host: '',
    port: 0,
    database: dbPath,
    username: '',
    tlsMode: 'disable',
    aiReadOnlyUsername: null,
    maskedColumnPatterns: [],
  }
}

describeDriverContract('SqliteDriver', () => ({
  driver: createSqliteDriver(cfg()),
  config: cfg(),
  read: {
    statement: 'SELECT id FROM nums ORDER BY id',
    expectedRowCount: 5,
    foreignStatement: 'SELECT id FROM other ORDER BY id',
  },
  // id = id + 100 은 값과 무관하게 항상 2행 → 여러 번 실행돼도 rowsAffected 2(멱등 행수).
  write: { statement: 'UPDATE w SET id = id + 100', expectedRowsAffected: 2 },
  requiresConnection: true,
}))

afterAll(() => rmSync(dir, { recursive: true, force: true }))
