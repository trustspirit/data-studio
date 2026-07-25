import { describe, expect, it } from 'vitest'
import { PostgresDataCapability } from '@main/drivers/postgres/PostgresDataCapability'
import type { PgClientLike } from '@main/drivers/postgres/PostgresDriver'
import type { ExecutionContext } from '@main/core/driver/ExecutionContext'
import type { RowChange } from '@shared/types/operation'

function ctx(): ExecutionContext {
  return { requestId: 'r', signal: new AbortController().signal, resolveColumnOrigins: false }
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

  it('bytes는 base64 문자열이 아니라 디코드한 바이트로 바인딩한다', async () => {
    // wv.v는 base64 ASCII다. 그대로 넘기면 bytea 컬럼에 'AQL/' 같은 문자열이
    // 저장된다 — pg는 백슬래시 없는 문자열을 escape 형식 bytea로 조용히
    // 재해석하므로 에러도 나지 않는다.
    const { conn, rec } = stubConn()
    const data = new PostgresDataCapability(() => conn)
    await data.applyChanges(ctx(), 'public', 't', [
      {
        op: 'insert',
        values: { blob: { t: 'bytes', v: 'AQL/', enc: 'base64', truncated: false } },
      },
    ])
    const bound = rec.values[rec.texts.findIndex((t) => t.startsWith('INSERT'))]
    expect(bound?.[0]).toBeInstanceOf(Buffer)
    expect([...(bound?.[0] as Buffer)]).toEqual([0x01, 0x02, 0xff])
  })

  it('이진 PK도 바이트로 바인딩한다 — 안 그러면 0행 삭제가 성공으로 보고된다', async () => {
    // pk는 사용자가 타이핑한 값이 아니라 조회 결과에서 그대로 온다. 이진 PK
    // 테이블이면 여기로 {t:'bytes'}가 도달하고, base64 문자열로 WHERE하면
    // 어떤 행과도 매칭되지 않은 채 applyChanges가 성공을 돌려준다.
    const { conn, rec } = stubConn()
    const data = new PostgresDataCapability(() => conn)
    await data.applyChanges(ctx(), 'public', 't', [
      { op: 'delete', pk: { id: { t: 'bytes', v: 'AAEC', enc: 'base64', truncated: false } } },
    ])
    const bound = rec.values[rec.texts.findIndex((t) => t.startsWith('DELETE'))]
    expect(bound?.[0]).toBeInstanceOf(Buffer)
    expect([...(bound?.[0] as Buffer)]).toEqual([0x00, 0x01, 0x02])
  })

  it('잘린 bytes는 되쓰기를 거부한다 (남은 바이트를 복원할 수 없다)', async () => {
    const { conn, rec } = stubConn()
    const data = new PostgresDataCapability(() => conn)
    await expect(
      data.applyChanges(ctx(), 'public', 't', [
        {
          op: 'update',
          pk: { id: { t: 'int', v: 1 } },
          set: { blob: { t: 'bytes', v: 'AQL/', enc: 'base64', truncated: true } },
        },
      ]),
    ).rejects.toThrow(/truncated/)
    // 실패해도 트랜잭션은 정리돼야 한다.
    expect(rec.texts).toContain('ROLLBACK')
    expect(rec.texts).not.toContain('COMMIT')
  })

  it('base64가 아닌 bytes는 조용히 다른 바이트를 쓰지 않고 거부한다', async () => {
    // Buffer.from(_, 'base64')은 알파벳 밖 문자를 조용히 버린다.
    const { conn } = stubConn()
    const data = new PostgresDataCapability(() => conn)
    await expect(
      data.applyChanges(ctx(), 'public', 't', [
        { op: 'insert', values: { blob: { t: 'bytes', v: 'not base64!!', enc: 'base64', truncated: false } } },
      ]),
    ).rejects.toThrow(/base64/)
  })

  it('bigint/decimal/date는 문자열 그대로 바인딩한다 (정밀도·벽시계 보존)', async () => {
    const { conn, rec } = stubConn()
    const data = new PostgresDataCapability(() => conn)
    await data.applyChanges(ctx(), 'public', 't', [
      {
        op: 'insert',
        values: {
          big: { t: 'bigint', v: '9223372036854775807' },
          amount: { t: 'decimal', v: '0.10' },
          at: { t: 'date', v: '2024-01-15 12:00:00' },
        },
      },
    ])
    expect(rec.values[rec.texts.findIndex((t) => t.startsWith('INSERT'))]).toEqual([
      '9223372036854775807',
      '0.10',
      '2024-01-15 12:00:00',
    ])
  })

  it('이미 abort된 signal이면 아무 쿼리도 실행하지 않고 던진다', async () => {
    const { conn, rec } = stubConn()
    const controller = new AbortController()
    controller.abort()
    const data = new PostgresDataCapability(() => conn)
    await expect(
      data.applyChanges({ requestId: 'r', signal: controller.signal, resolveColumnOrigins: false }, 'public', 't', changes),
    ).rejects.toThrow()
    expect(rec.texts).toEqual([])
  })
})
