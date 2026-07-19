import { describe, expect, it } from 'vitest'
import { buildResultSet } from '@shared/types/resultSet'
import { wire } from '@shared/types/wire'

const COLUMNS = [
  { name: 'id', type: 'int8' },
  { name: 'email', type: 'text' },
]

function row(id: number, email: string) {
  return [wire.int(id), wire.str(email)]
}

describe('buildResultSet', () => {
  it('상한에 걸리지 않으면 모든 행을 담는다', () => {
    const result = buildResultSet({
      requestId: 'req-1',
      columns: COLUMNS,
      rows: [row(1, 'a@x.com'), row(2, 'b@x.com')],
      page: { cursor: null, maxRows: 100, maxBytes: 1_000_000 },
      durationMs: 5,
      nextCursor: null,
    })

    expect(result.rows).toHaveLength(2)
    expect(result.page.hasMore).toBe(false)
    expect(result.meta.truncatedRows).toBe(false)
    expect(result.meta.truncatedBytes).toBe(false)
  })

  it('행 수 상한을 넘으면 잘라내고 표시한다', () => {
    const result = buildResultSet({
      requestId: 'req-1',
      columns: COLUMNS,
      rows: [row(1, 'a'), row(2, 'b'), row(3, 'c')],
      page: { cursor: null, maxRows: 2, maxBytes: 1_000_000 },
      durationMs: 5,
      nextCursor: null,
    })

    expect(result.rows).toHaveLength(2)
    expect(result.meta.truncatedRows).toBe(true)
    expect(result.page.hasMore).toBe(true)
  })

  it('byte 상한이 행 수 상한보다 먼저 걸리면 byte 기준으로 잘라낸다', () => {
    const big = 'x'.repeat(5_000)
    const result = buildResultSet({
      requestId: 'req-1',
      columns: COLUMNS,
      rows: [row(1, big), row(2, big), row(3, big)],
      page: { cursor: null, maxRows: 100, maxBytes: 8_000 },
      durationMs: 5,
      nextCursor: null,
    })

    expect(result.rows.length).toBeLessThan(3)
    expect(result.meta.truncatedBytes).toBe(true)
    expect(result.page.hasMore).toBe(true)
  })

  it('첫 행이 byte 상한을 넘어도 최소 한 행은 돌려준다', () => {
    // 한 행도 못 담으면 호출자가 영원히 전진하지 못한다.
    const huge = 'x'.repeat(100_000)
    const result = buildResultSet({
      requestId: 'req-1',
      columns: COLUMNS,
      rows: [row(1, huge), row(2, huge)],
      page: { cursor: null, maxRows: 100, maxBytes: 100 },
      durationMs: 5,
      nextCursor: null,
    })

    expect(result.rows).toHaveLength(1)
    expect(result.meta.truncatedBytes).toBe(true)
  })

  it('page.bytes가 실제로 담은 행들의 추정 크기를 반영한다', () => {
    const result = buildResultSet({
      requestId: 'req-1',
      columns: COLUMNS,
      rows: [row(1, 'a'), row(2, 'b')],
      page: { cursor: null, maxRows: 100, maxBytes: 1_000_000 },
      durationMs: 5,
      nextCursor: null,
    })

    expect(result.page.bytes).toBeGreaterThan(0)
    expect(result.page.rowCount).toBe(2)
  })

  it('드라이버가 준 다음 커서를 그대로 전달한다', () => {
    const result = buildResultSet({
      requestId: 'req-1',
      columns: COLUMNS,
      rows: [row(1, 'a')],
      page: { cursor: null, maxRows: 100, maxBytes: 1_000_000 },
      durationMs: 5,
      nextCursor: 'opaque-cursor-abc',
    })

    expect(result.page.cursor).toBe('opaque-cursor-abc')
    expect(result.page.hasMore).toBe(true)
  })

  it('잘라낸 경우 드라이버 커서가 없어도 hasMore를 세운다', () => {
    const result = buildResultSet({
      requestId: 'req-1',
      columns: COLUMNS,
      rows: [row(1, 'a'), row(2, 'b')],
      page: { cursor: null, maxRows: 1, maxBytes: 1_000_000 },
      durationMs: 5,
      nextCursor: null,
    })

    expect(result.page.hasMore).toBe(true)
  })

  it('requestId와 durationMs를 그대로 담는다', () => {
    const result = buildResultSet({
      requestId: 'req-42',
      columns: COLUMNS,
      rows: [],
      page: { cursor: null, maxRows: 100, maxBytes: 1_000_000 },
      durationMs: 123,
      nextCursor: null,
    })

    expect(result.requestId).toBe('req-42')
    expect(result.meta.durationMs).toBe(123)
  })

  it('결과 전체가 structuredClone으로 IPC를 건널 수 있다', () => {
    const result = buildResultSet({
      requestId: 'req-1',
      columns: COLUMNS,
      rows: [row(1, 'a@x.com')],
      page: { cursor: null, maxRows: 100, maxBytes: 1_000_000 },
      durationMs: 5,
      nextCursor: null,
    })

    expect(structuredClone(result)).toEqual(result)
  })
})
