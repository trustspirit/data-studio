import { describe, expect, it } from 'vitest'
import type { Driver } from '@main/core/driver/Driver'
import type { ExecutionContext } from '@main/core/driver/ExecutionContext'
import { buildResultSet, type PageRequest, type ResultSet } from '@shared/types/resultSet'
import { describeDriverContract } from './driverContract'

/**
 * 계약 스위트 자체에 대한 테스트.
 *
 * `describeDriverContract`가 지켜야 할 성질은 "모든 드라이버를 통과시킨다"가
 * 아니라 **"선언하지 않은 능력은 건너뛰고, 선언한 능력은 끝까지 검증한다"**이다.
 * MemoryDriver 하나로는 이걸 확인할 수 없다 — 그 드라이버는 모든 능력을
 * 갖고 있어서 모든 구역이 실행되기 때문이다.
 *
 * 여기서는 `sql`만, 그것도 `explain`/`beginReadOnly` 없이 구현한 최소 드라이버를
 * 계약에 통과시킨다. 이것이 초록으로 뜨는 것 자체가, Redis나 Kafka처럼 적게
 * 지원하는 드라이버도 같은 스위트를 통과할 수 있다는 증거다. 반대로 계약이
 * 선택 멤버를 필수로 착각하게 되면 이 파일이 즉시 빨개진다.
 */

const ROWS = [[{ t: 'int' as const, v: 1 }], [{ t: 'int' as const, v: 2 }]]

function execute(ctx: ExecutionContext, _sql: string, page: PageRequest): Promise<ResultSet> {
  if (ctx.signal.aborted) {
    return Promise.reject(new Error(`execution aborted: ${ctx.requestId}`))
  }

  const offset = page.cursor === null ? 0 : Number(page.cursor)
  if (!Number.isInteger(offset) || offset < 0) {
    return Promise.reject(new Error(`malformed cursor: ${page.cursor ?? 'null'}`))
  }

  return Promise.resolve(
    buildResultSet({
      requestId: ctx.requestId,
      columns: [{ name: 'n', type: 'int8' }],
      rows: ROWS.slice(offset),
      page,
      durationMs: 0,
      cursorAt: (kept) => (offset + kept < ROWS.length ? String(offset + kept) : null),
    }),
  )
}

/** sql만, explain/beginReadOnly/schema 없이 구현한 드라이버. */
function createMinimalDriver(): Driver {
  return {
    id: 'minimal-1',
    engine: 'redis',
    connect: () => Promise.resolve(),
    disconnect: () => Promise.resolve(),
    ping: () => Promise.resolve(0),
    sql: {
      execute,
      classify: (sql) => {
        const head = sql.trim().toLowerCase()
        if (head.startsWith('select')) return 'read'
        if (head.startsWith('delete')) return 'write'
        return 'unknown'
      },
    },
  }
}

describeDriverContract('MinimalDriver(sql만)', createMinimalDriver)

describe('계약 스위트가 없는 능력을 건너뛴다', () => {
  it('최소 드라이버는 선택 멤버와 schema 능력을 실제로 갖고 있지 않다', () => {
    // 위 describeDriverContract 호출이 초록인 것이 의미를 가지려면, 이
    // 드라이버가 정말로 적게 지원한다는 사실이 확인되어야 한다. 이 단언이
    // 없으면 fixture가 슬그머니 전부 구현하게 되어도 아무도 눈치채지 못한다.
    const driver = createMinimalDriver()

    expect(driver.sql).toBeDefined()
    // 함수를 값으로 꺼내면 `this`가 끊기므로 존재 여부만 typeof로 본다.
    expect(typeof driver.sql?.explain).toBe('undefined')
    expect(typeof driver.sql?.beginReadOnly).toBe('undefined')
    expect(driver.schema).toBeUndefined()
  })
})
