import { describe, it, expect, vi } from 'vitest'
import { DynamoCapabilityExecutor } from '@main/infrastructure/execution/DynamoCapabilityExecutor'
import type { CapabilityExecuteInput } from '@main/core/execution/CapabilityExecutor'
import type { Operation } from '@shared/types/operation'
import type { ResultSet } from '@shared/types/resultSet'

const RS = { requestId: 'r', columns: [], rows: [], page: { cursor: null, hasMore: false, rowCount: 0, bytes: 0 }, meta: { durationMs: 0, truncatedRows: false, truncatedBytes: false, rowsAffected: null } } as ResultSet

function inputFor(operation: Operation, cap: Partial<{ listTables: any; scan: any; partiql: any; isReadOnlyStatement: any }>): CapabilityExecuteInput {
  const dynamo = {
    listTables: cap.listTables ?? vi.fn(async () => RS),
    scan: cap.scan ?? vi.fn(async () => RS),
    partiql: cap.partiql ?? vi.fn(async () => RS),
    isReadOnlyStatement: cap.isReadOnlyStatement ?? (() => true),
  }
  return {
    ctx: { requestId: 'r', signal: new AbortController().signal },
    driver: { id: 'c', engine: 'dynamodb', connect: async () => {}, disconnect: async () => {}, ping: async () => 0, dynamo } as any,
    operation, page: { cursor: null, maxRows: 100, maxBytes: 1000 },
    limits: { timeoutMs: 1000, maxRows: 100, maxBytes: 1000 }, readOnlyScope: false, connectionId: 'c',
  }
}

describe('DynamoCapabilityExecutor', () => {
  const ex = new DynamoCapabilityExecutor()

  it('listTables를 드라이버로 넘기고 rows로 감싼다', async () => {
    const listTables = vi.fn(async () => RS)
    const out = await ex.execute(inputFor({ kind: 'dynamo', op: 'listTables' }, { listTables }))
    expect(listTables).toHaveBeenCalledOnce()
    expect(out).toEqual({ kind: 'rows', rows: RS })
  })

  it('scan을 table과 함께 넘긴다', async () => {
    const scan = vi.fn(async () => RS)
    await ex.execute(inputFor({ kind: 'dynamo', op: 'scan', table: 't' }, { scan }))
    expect(scan).toHaveBeenCalledWith(expect.anything(), { table: 't' }, expect.anything())
  })

  it('읽기 전용 PartiQL은 드라이버로 넘긴다', async () => {
    const partiql = vi.fn(async () => RS)
    await ex.execute(inputFor({ kind: 'dynamo', op: 'partiql', statement: 'SELECT * FROM "t"' }, { partiql, isReadOnlyStatement: () => true }))
    expect(partiql).toHaveBeenCalledWith(expect.anything(), { statement: 'SELECT * FROM "t"' }, expect.anything())
  })

  it('비-SELECT PartiQL은 드라이버 도달 전에 관문에서 던진다', async () => {
    const partiql = vi.fn(async () => RS)
    await expect(
      ex.execute(inputFor({ kind: 'dynamo', op: 'partiql', statement: 'DELETE FROM "t"' }, { partiql, isReadOnlyStatement: () => false })),
    ).rejects.toThrow(/read-only/)
    expect(partiql).not.toHaveBeenCalled()
  })
})
