import mysql from 'mysql2/promise'
import { randomUUID } from 'node:crypto'

export const MYSQL_URL =
  process.env.DATACON_TEST_MYSQL_URL ?? 'mysql://root:rootpw@localhost:3306/datacon_test'
export const MARIADB_URL =
  process.env.DATACON_TEST_MARIADB_URL ?? 'mysql://root:rootpw@localhost:3307/datacon_test'

async function probe(url: string): Promise<boolean> {
  try {
    const conn = await mysql.createConnection(url)
    await conn.query('SELECT 1')
    await conn.end()
    return true
  } catch {
    return false
  }
}

// 모듈 로드 시 한 번 프로브. 서버가 없으면 통합 테스트가 전부 스킵된다.
export const MYSQL_AVAILABLE: boolean = await probe(MYSQL_URL)
export const MARIADB_AVAILABLE: boolean = await probe(MARIADB_URL)

/**
 * uuid 이름의 데이터베이스를 만들고 seedSql을 그 안에서 실행한 뒤 fn(dbName)을 부른다.
 * 끝나면 DROP DATABASE. 병렬 워커 충돌을 피하려 이름에 uuid를 쓴다.
 * MySQL은 schema=database라 Postgres의 CREATE SCHEMA 대신 CREATE DATABASE를 쓴다.
 */
export async function withDatabase(
  url: string,
  seedSql: string,
  fn: (dbName: string) => Promise<void>,
): Promise<void> {
  const dbName = `t_${randomUUID().replace(/-/g, '').slice(0, 12)}`
  const admin = await mysql.createConnection(url)
  try {
    await admin.query(`CREATE DATABASE \`${dbName}\``)
    await admin.changeUser({ database: dbName })
    if (seedSql.trim() !== '') {
      for (const stmt of seedSql
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean)) {
        await admin.query(stmt)
      }
    }
    await fn(dbName)
  } finally {
    try {
      await admin.query(`DROP DATABASE IF EXISTS \`${dbName}\``)
    } finally {
      await admin.end()
    }
  }
}
