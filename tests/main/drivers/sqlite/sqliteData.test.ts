import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { SqliteDataCapability } from '@main/drivers/sqlite/SqliteDataCapability'
import type { DatabaseInstance } from '@main/drivers/sqlite/SqliteDriver'
import type { ExecutionContext } from '@main/core/driver/ExecutionContext'
import type { RowChange } from '@shared/types/operation'

let dir: string
let db: DatabaseInstance
function ctx(): ExecutionContext {
  return { requestId: 'r', signal: new AbortController().signal }
}
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'datacon-sqlite-data-'))
  db = new Database(join(dir, 'data.db'))
})
beforeEach(() => {
  db.exec(
    'DROP TABLE IF EXISTS t; CREATE TABLE t (id integer primary key, name text, flag integer); ' +
      "INSERT INTO t VALUES (1,'a',0),(2,'b',1)",
  )
})
afterAll(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})
function cap(): SqliteDataCapability {
  return new SqliteDataCapability(() => db)
}

describe('SqliteDataCapability', () => {
  it('buildBrowse가 식별자를 인용하고 정렬을 붙인다', () => {
    const plain = cap().buildBrowse('main', 't')
    expect(plain.sql).toBe('SELECT * FROM "main"."t"')
    const sorted = cap().buildBrowse('main', 't', { column: 'name', direction: 'desc' })
    expect(sorted.sql).toBe('SELECT * FROM "main"."t" ORDER BY "name" DESC')
  })

  it('applyChanges가 insert/update/delete를 원자적으로 적용한다', async () => {
    const changes: RowChange[] = [
      { op: 'insert', values: { id: { t: 'int', v: 3 }, name: { t: 'str', v: 'c' }, flag: { t: 'bool', v: true } } },
      { op: 'update', pk: { id: { t: 'int', v: 1 } }, set: { name: { t: 'str', v: 'A' } } },
      { op: 'delete', pk: { id: { t: 'int', v: 2 } } },
    ]
    const res = await cap().applyChanges(ctx(), 'main', 't', changes)
    expect(res.affected).toBe(3)
    const rows = db.prepare('SELECT id, name, flag FROM t ORDER BY id').all()
    expect(rows).toEqual([
      { id: 1, name: 'A', flag: 0 },
      { id: 3, name: 'c', flag: 1 },
    ])
  })

  it('명시적 NULL을 바인딩한다', async () => {
    await cap().applyChanges(ctx(), 'main', 't', [
      { op: 'update', pk: { id: { t: 'int', v: 1 } }, set: { name: { t: 'null' } } },
    ])
    const row = db.prepare('SELECT name FROM t WHERE id = 1').get() as { name: string | null }
    expect(row.name).toBeNull()
  })

  it('중간 실패 시 전체가 롤백된다', async () => {
    // 두 번째 insert가 PK 충돌(id=1) → 트랜잭션 전체 롤백, 첫 insert(id=3)도 남지 않아야 한다.
    const changes: RowChange[] = [
      { op: 'insert', values: { id: { t: 'int', v: 3 }, name: { t: 'str', v: 'c' }, flag: { t: 'int', v: 0 } } },
      { op: 'insert', values: { id: { t: 'int', v: 1 }, name: { t: 'str', v: 'dup' }, flag: { t: 'int', v: 0 } } },
    ]
    await expect(cap().applyChanges(ctx(), 'main', 't', changes)).rejects.toThrow()
    const count = db.prepare('SELECT COUNT(*) AS n FROM t').get() as { n: number }
    expect(count.n).toBe(2) // 원래 2행 그대로
  })

  it('이미 취소된 컨텍스트는 applyChanges를 거부한다', async () => {
    const c = new AbortController()
    c.abort()
    await expect(
      cap().applyChanges({ requestId: 'r', signal: c.signal }, 'main', 't', [
        { op: 'delete', pk: { id: { t: 'int', v: 1 } } },
      ]),
    ).rejects.toThrow()
  })
})
