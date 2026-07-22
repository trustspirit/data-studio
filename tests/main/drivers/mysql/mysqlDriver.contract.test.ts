import { afterAll, beforeAll, describe } from 'vitest'
import mysql from 'mysql2/promise'
import type { ConnectionConfig, EngineId } from '@shared/types/connection'
import { createMysqlDriver } from '@main/drivers/mysql'
import { describeDriverContract } from '../../../contract/driverContract'
import { MYSQL_AVAILABLE, MYSQL_URL, MARIADB_AVAILABLE, MARIADB_URL } from '../../../contract/mysqlTestEnv'

const SEED = [
  'CREATE TABLE IF NOT EXISTS nums (id int primary key)',
  'DELETE FROM nums',
  'INSERT INTO nums VALUES (1),(2),(3),(4),(5)',
  'CREATE TABLE IF NOT EXISTS other (id int primary key)',
  'DELETE FROM other',
  'INSERT INTO other VALUES (10),(20),(30)',
  'CREATE TABLE IF NOT EXISTS w (id int primary key)',
  'DELETE FROM w',
  'INSERT INTO w VALUES (1),(2)',
]

function makeSuite(engine: EngineId, url: string, available: boolean): void {
  if (!available) {
    describe.skip(`MysqlDriver[${engine}] 계약 (서버 없음)`, () => {})
    return
  }

  const u = new URL(url)
  const cfg: ConnectionConfig = {
    id: `contract-${engine}`,
    name: engine,
    engine,
    host: u.hostname,
    port: Number(u.port),
    database: u.pathname.slice(1),
    username: decodeURIComponent(u.username),
    tlsMode: 'disable',
    aiReadOnlyUsername: null,
    maskedColumnPatterns: [],
  }
  const password = decodeURIComponent(u.password)

  beforeAll(async () => {
    const admin = await mysql.createConnection(url)
    try {
      for (const statement of SEED) await admin.query(statement)
    } finally {
      await admin.end()
    }
  })

  afterAll(async () => {
    const admin = await mysql.createConnection(url)
    try {
      for (const table of ['nums', 'other', 'w']) await admin.query(`DROP TABLE IF EXISTS \`${table}\``)
    } finally {
      await admin.end()
    }
  })

  describeDriverContract(`MysqlDriver[${engine}]`, () => ({
    driver: createMysqlDriver(cfg, { getPassword: () => Promise.resolve(password) }),
    config: cfg,
    read: {
      statement: 'SELECT id FROM nums ORDER BY id',
      expectedRowCount: 5,
      foreignStatement: 'SELECT id FROM other ORDER BY id',
    },
    write: { statement: 'UPDATE w SET id = id + 100', expectedRowsAffected: 2 },
    requiresConnection: true,
  }))
}

makeSuite('mysql', MYSQL_URL, MYSQL_AVAILABLE)
makeSuite('mariadb', MARIADB_URL, MARIADB_AVAILABLE)
