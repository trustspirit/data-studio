import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { SqliteSqlCapability } from '@main/drivers/sqlite/SqliteSqlCapability'
import type { DatabaseInstance } from '@main/drivers/sqlite/SqliteDriver'
import type { ExecutionContext } from '@main/core/driver/ExecutionContext'

let dir: string
let db: DatabaseInstance

function ctx(requestId = 'r'): ExecutionContext {
  return { requestId, signal: new AbortController().signal }
}
function abortedCtx(): ExecutionContext {
  const c = new AbortController()
  c.abort()
  return { requestId: 'r', signal: c.signal }
}
const FULL = { cursor: null, maxRows: 1000, maxBytes: 8_000_000 }

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'datacon-sqlite-sql-'))
  db = new Database(join(dir, 'sql.db'))
  db.exec('CREATE TABLE nums (id integer primary key); INSERT INTO nums VALUES (1),(2),(3)')
  db.exec('CREATE TABLE w (id integer primary key); INSERT INTO w VALUES (1),(2)')
})
afterAll(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

function cap(): SqliteSqlCapability {
  return new SqliteSqlCapability(() => db)
}

describe('SqliteSqlCapability', () => {
  it('execute가 requestId를 실은 ResultSet을 준다', async () => {
    const r = await cap().execute(ctx('echo'), 'SELECT id FROM nums ORDER BY id', FULL)
    expect(r.requestId).toBe('echo')
    expect(r.rows).toHaveLength(3)
    expect(r.page.rowCount).toBe(3)
    expect(structuredClone(r)).toEqual(r)
  })

  it('이미 취소된 컨텍스트는 execute를 거부한다', async () => {
    await expect(cap().execute(abortedCtx(), 'SELECT id FROM nums', FULL)).rejects.toThrow()
  })

  it('한 행씩 커서로 이어 읽은 결과가 한 번에 읽은 결과와 같다', async () => {
    const sql = cap()
    const full = await sql.execute(ctx(), 'SELECT id FROM nums ORDER BY id', FULL)
    const collected: unknown[] = []
    let cursor: string | null = null
    for (let i = 0; i < 10; i++) {
      const page = await sql.execute(ctx(), 'SELECT id FROM nums ORDER BY id', {
        cursor,
        maxRows: 1,
        maxBytes: FULL.maxBytes,
      })
      collected.push(...page.rows)
      cursor = page.page.cursor
      if (cursor === null) break
    }
    expect(collected).toEqual(full.rows)
  })

  it('발급하지 않은 커서와 다른 질의의 커서를 거부한다', async () => {
    const sql = cap()
    await expect(
      sql.execute(ctx(), 'SELECT id FROM nums', { cursor: ' garbage', maxRows: 1, maxBytes: FULL.maxBytes }),
    ).rejects.toThrow()
    const first = await sql.execute(ctx(), 'SELECT id FROM nums ORDER BY id', {
      cursor: null,
      maxRows: 1,
      maxBytes: FULL.maxBytes,
    })
    const cursor = first.page.cursor as string
    await expect(
      sql.execute(ctx(), 'SELECT id FROM w ORDER BY id', { cursor, maxRows: 1, maxBytes: FULL.maxBytes }),
    ).rejects.toThrow()
  })

  it('쓰기 문장은 rowsAffected를 수치로 보고하고 커서를 내지 않는다', async () => {
    const r = await cap().execute(ctx(), 'UPDATE w SET id = id + 100', FULL)
    expect(r.meta.rowsAffected).toBe(2)
    expect(r.page.cursor).toBeNull()
  })

  it('classify가 읽기/쓰기를 구분한다', () => {
    const sql = cap()
    expect(sql.classify('SELECT 1')).toBe('read')
    expect(sql.classify('DELETE FROM w')).toBe('write')
  })

  it('beginReadOnly 범위는 쓰기를 막고 end 후 다시 허용한다', async () => {
    const sql = cap()
    const scope = await sql.beginReadOnly(ctx())
    await expect(scope.execute(ctx(), 'UPDATE w SET id = id + 1', FULL)).rejects.toThrow()
    await scope.end()
    // end 후에는 쓰기가 다시 된다.
    const r = await sql.execute(ctx(), 'UPDATE w SET id = id + 0', FULL)
    expect(r.meta.rowsAffected).toBe(2)
  })
})
