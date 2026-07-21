import { describe, expect, it } from 'vitest'
import { PostgresDataCapability } from '@main/drivers/postgres/PostgresDataCapability'
import type { PgClientLike } from '@main/drivers/postgres/PostgresDriver'
import type { ExecutionContext } from '@main/core/driver/ExecutionContext'
import type { RowChange } from '@shared/types/operation'

function ctx(): ExecutionContext {
  return { requestId: 'r', signal: new AbortController().signal }
}
interface Recorded { texts: string[]; values: unknown[][] }
function stubConn(over: { failOnText?: RegExp } = {}): { conn: PgClientLike; rec: Recorded } {
  const rec: Recorded = { texts: [], values: [] }
  const conn = {
    connect: () => Promise.resolve(),
    end: () => Promise.resolve(),
    processID: 1,
    query: (config: { text: string; values?: readonly unknown[] }) => {
      rec.texts.push(config.text)
      rec.values.push([...(config.values ?? [])])
      if (over.failOnText && over.failOnText.test(config.text)) {
        return Promise.reject(new Error('constraint violation'))
      }
      return Promise.resolve({ rows: [], fields: [], rowCount: 1, command: 'X' })
    },
  } as unknown as PgClientLike
  return { conn, rec }
}

describe('PostgresDataCapability.applyChanges', () => {
  const changes: readonly RowChange[] = [
    { op: 'delete', pk: { id: { t: 'int', v: 5 } } },
    { op: 'update', pk: { id: { t: 'int', v: 1 } }, set: { name: { t: 'str', v: 'x' } } },
    { op: 'insert', values: { id: { t: 'int', v: 9 }, name: { t: 'str', v: 'n' } } },
  ]

  it('BEGIN → 문장들 → COMMIT 순으로 실행하고 affected를 합산한다', async () => {
    const { conn, rec } = stubConn()
    const data = new PostgresDataCapability(() => conn)
    const result = await data.applyChanges(ctx(), 'public', 't', changes)
    expect(rec.texts[0]).toBe('BEGIN')
    expect(rec.texts[rec.texts.length - 1]).toBe('COMMIT')
    expect(rec.texts).not.toContain('ROLLBACK')
    expect(result.affected).toBe(3) // rowCount 1씩 * 3
  })

  it('DELETE/UPDATE는 PK로 WHERE하고 값은 전부 파라미터다', async () => {
    const { conn, rec } = stubConn()
    const data = new PostgresDataCapability(() => conn)
    await data.applyChanges(ctx(), 'public', 't', changes)
    const del = rec.texts.find((t) => t.startsWith('DELETE'))
    const upd = rec.texts.find((t) => t.startsWith('UPDATE'))
    expect(del).toBe('DELETE FROM "public"."t" WHERE "id" = $1')
    expect(upd).toBe('UPDATE "public"."t" SET "name" = $1 WHERE "id" = $2')
    // 값 리터럴이 SQL에 없다(전부 $N).
    expect(upd).not.toContain("'x'")
  })

  it('한 문장이 실패하면 ROLLBACK하고 COMMIT하지 않으며 다시 던진다(원자성)', async () => {
    const { conn, rec } = stubConn({ failOnText: /^UPDATE/ })
    const data = new PostgresDataCapability(() => conn)
    await expect(data.applyChanges(ctx(), 'public', 't', changes)).rejects.toThrow('constraint violation')
    expect(rec.texts).toContain('ROLLBACK')
    expect(rec.texts).not.toContain('COMMIT')
  })

  it('식별자에 낀 큰따옴표를 이중화해 인젝션을 막는다', async () => {
    const { conn, rec } = stubConn()
    const data = new PostgresDataCapability(() => conn)
    await data.applyChanges(ctx(), 'public', 't', [
      { op: 'delete', pk: { 'ev"il': { t: 'int', v: 1 } } },
    ])
    const del = rec.texts.find((t) => t.startsWith('DELETE'))
    expect(del).toBe('DELETE FROM "public"."t" WHERE "ev""il" = $1')
  })

  it('이미 abort된 signal이면 아무 쿼리도 실행하지 않고 던진다', async () => {
    const { conn, rec } = stubConn()
    const controller = new AbortController()
    controller.abort()
    const data = new PostgresDataCapability(() => conn)
    await expect(
      data.applyChanges({ requestId: 'r', signal: controller.signal }, 'public', 't', changes),
    ).rejects.toThrow()
    expect(rec.texts).toEqual([])
  })
})
