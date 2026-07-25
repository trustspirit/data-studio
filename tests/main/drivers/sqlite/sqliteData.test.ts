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
  return { requestId: 'r', signal: new AbortController().signal, resolveColumnOrigins: false }
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

  it('bytes를 base64 문자열이 아니라 BLOB으로 저장한다', async () => {
    // wv.v는 base64 ASCII다. 그대로 바인딩하면 typeof(b)가 'text'가 되고
    // 내용도 원본 바이트가 아니라 'AQL/'이 된다.
    db.exec('DROP TABLE IF EXISTS b; CREATE TABLE b (id integer primary key, payload blob)')
    await cap().applyChanges(ctx(), 'main', 'b', [
      {
        op: 'insert',
        values: { id: { t: 'int', v: 1 }, payload: { t: 'bytes', v: 'AQL/', enc: 'base64', truncated: false } },
      },
    ])
    const row = db.prepare('SELECT typeof(payload) AS ty, hex(payload) AS hex FROM b').get() as {
      ty: string
      hex: string
    }
    expect(row).toEqual({ ty: 'blob', hex: '0102FF' })
  })

  it('이진 PK로 삭제하면 실제로 그 행이 지워진다', async () => {
    // SQLite는 BLOB과 TEXT를 서로 다른 값으로 비교한다 — base64 문자열로
    // WHERE하면 에러 없이 0행이 지워지고 성공으로 보고된다.
    db.exec('DROP TABLE IF EXISTS bpk; CREATE TABLE bpk (id blob primary key, n int)')
    db.prepare('INSERT INTO bpk VALUES (?, ?)').run(Buffer.from([0x00, 0x01, 0x02]), 7)
    const res = await cap().applyChanges(ctx(), 'main', 'bpk', [
      { op: 'delete', pk: { id: { t: 'bytes', v: 'AAEC', enc: 'base64', truncated: false } } },
    ])
    expect(res.affected).toBe(1)
    expect((db.prepare('SELECT COUNT(*) AS n FROM bpk').get() as { n: number }).n).toBe(0)
  })

  it('잘린 bytes는 되쓰기를 거부한다 (남은 바이트를 복원할 수 없다)', async () => {
    await expect(
      cap().applyChanges(ctx(), 'main', 't', [
        {
          op: 'update',
          pk: { id: { t: 'int', v: 1 } },
          set: { name: { t: 'bytes', v: 'AQL/', enc: 'base64', truncated: true } },
        },
      ]),
    ).rejects.toThrow(/truncated/)
  })

  it('이미 취소된 컨텍스트는 applyChanges를 거부한다', async () => {
    const c = new AbortController()
    c.abort()
    await expect(
      cap().applyChanges({ requestId: 'r', signal: c.signal, resolveColumnOrigins: false }, 'main', 't', [
        { op: 'delete', pk: { id: { t: 'int', v: 1 } } },
      ]),
    ).rejects.toThrow()
  })
})
