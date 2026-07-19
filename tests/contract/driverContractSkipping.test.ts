import { describe, expect, it } from 'vitest'
import type { Driver } from '@main/core/driver/Driver'
import type { ExecutionContext } from '@main/core/driver/ExecutionContext'
import type { ConnectionConfig } from '@shared/types/connection'
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
 *
 * 동시에 이 드라이버는 **`schema` 능력이 없어도 페이지네이션 계약을 면제받지
 * 못한다**는 증거이기도 하다. `execute`와 커서는 `sql` 능력에 속한다 —
 * `schema`가 없다는 이유로 페이지네이션을 건너뛰면 SQL 드라이버가 계약의
 * 핵심을 통째로 우회하게 된다. 그래서 계약이 읽을 문장은 팩토리가 준다.
 */

const ROWS = [[{ t: 'int' as const, v: 1 }], [{ t: 'int' as const, v: 2 }]]

const CONFIG: ConnectionConfig = {
  id: 'minimal-1',
  name: 'Minimal',
  engine: 'redis',
  host: 'localhost',
  port: 6379,
  database: '0',
  username: '',
  tlsMode: 'disable',
  aiReadOnlyUsername: null,
  maskedColumnPatterns: [],
}

/**
 * sql만, explain/beginReadOnly/schema 없이 구현한 드라이버.
 *
 * **`connect` 없이는 아무것도 하지 않는다.** 실제 서버에 붙는 드라이버가
 * 그렇기 때문이다. 계약 스위트가 드라이버를 쓰기 전에 정말로 `connect`를
 * 부르지 않으면 이 fixture가 즉시 빨개진다 — 동기 팩토리 시절의 계약은
 * 이런 드라이버를 아예 통과시킬 수 없었다.
 */
function createMinimalDriver(): Driver {
  let connected = false

  function requireConnection(): void {
    if (!connected) throw new Error('driver is not connected')
  }

  function execute(ctx: ExecutionContext, _sql: string, page: PageRequest): Promise<ResultSet> {
    try {
      requireConnection()
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)))
    }

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

  return {
    id: 'minimal-1',
    engine: 'redis',
    connect: () => {
      connected = true
      return Promise.resolve()
    },
    disconnect: () => {
      connected = false
      return Promise.resolve()
    },
    ping: () => {
      try {
        requireConnection()
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)))
      }
      return Promise.resolve(0)
    },
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

describeDriverContract('MinimalDriver(sql만)', () => ({
  driver: createMinimalDriver(),
  config: CONFIG,
  // schema 능력이 없어도 읽을 문장은 준다 — 그래서 페이지네이션 계약이 돈다.
  read: { statement: 'SELECT * FROM whatever', expectedRowCount: ROWS.length },
}))

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

  it('연결 없이는 동작하지 않는 드라이버다', async () => {
    // 위 계약 통과가 "connect가 no-op이라서" 얻어진 것이 아님을 못 박는다.
    // 이 단언이 없으면 fixture가 슬그머니 무연결 드라이버로 바뀌어도,
    // 계약이 connect를 부르지 않게 되어도 아무도 눈치채지 못한다.
    const driver = createMinimalDriver()

    await expect(driver.ping()).rejects.toThrow(/not connected/i)

    await driver.connect(CONFIG)
    await expect(driver.ping()).resolves.toBe(0)
  })
})
