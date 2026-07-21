import { describe, expect, it, vi } from 'vitest'
import { DataCapabilityExecutor } from '@main/infrastructure/execution/DataCapabilityExecutor'
import type { CapabilityExecuteInput } from '@main/core/execution/CapabilityExecutor'
import type { Driver } from '@main/core/driver/Driver'
import type { PageRequest, ResultSet } from '@shared/types/resultSet'
import type { ExecutionLimits } from '@shared/types/operation'

const page: PageRequest = { cursor: null, maxRows: 10, maxBytes: 1000 }
const limits: ExecutionLimits = { timeoutMs: 1000, maxRows: 10, maxBytes: 1000 }
function emptyResult(): ResultSet {
  return {
    requestId: 'r', columns: [], rows: [],
    page: { cursor: null, hasMore: false, rowCount: 0, bytes: 0 },
    meta: { durationMs: 0, truncatedRows: false, truncatedBytes: false, rowsAffected: null },
  }
}

function makeInput(over: Partial<CapabilityExecuteInput>, calls: { execute: unknown[][]; build: unknown[][]; scoped: number }): CapabilityExecuteInput {
  const driver = {
    id: 'c', engine: 'postgres',
    connect: () => Promise.resolve(), disconnect: () => Promise.resolve(), ping: () => Promise.resolve(1),
    sql: {
      execute: (_ctx: unknown, sql: string, pg: PageRequest, params?: readonly unknown[]) => {
        calls.execute.push([sql, pg, params])
        return Promise.resolve(emptyResult())
      },
      classify: () => 'read' as const,
      beginReadOnly: () => {
        calls.scoped += 1
        return Promise.resolve({
          execute: (_c: unknown, sql: string, pg: PageRequest, params?: readonly unknown[]) => {
            calls.execute.push(['scoped', sql, pg, params])
            return Promise.resolve(emptyResult())
          },
          end: () => Promise.resolve(),
        })
      },
    },
    data: {
      buildBrowse: (schema: string, table: string, sort?: unknown) => {
        calls.build.push([schema, table, sort])
        return { sql: `SELECT * FROM "${schema}"."${table}"`, params: [] }
      },
    },
  } as unknown as Driver
  return {
    ctx: { requestId: 'r', signal: new AbortController().signal },
    driver, operation: { kind: 'data', op: 'browse', schema: 'public', table: 'users' },
    page, limits, readOnlyScope: false,
    ...over,
  }
}

describe('DataCapabilityExecutor', () => {
  it('buildBrowse로 조립하고 rows 페이로드를 돌려준다', async () => {
    const calls = { execute: [] as unknown[][], build: [] as unknown[][], scoped: 0 }
    const out = await new DataCapabilityExecutor().execute(makeInput({}, calls))
    expect(out.kind).toBe('rows')
    expect(calls.build).toEqual([['public', 'users', undefined]])
    expect(calls.execute[0]?.[0]).toBe('SELECT * FROM "public"."users"') // 직접 경로
  })

  it('readOnlyScope=true(AI)면 읽기 전용 스코프 안에서 실행한다', async () => {
    const calls = { execute: [] as unknown[][], build: [] as unknown[][], scoped: 0 }
    await new DataCapabilityExecutor().execute(makeInput({ readOnlyScope: true }, calls))
    expect(calls.scoped).toBe(1)
    expect(calls.execute[0]?.[0]).toBe('scoped') // 스코프 경로로 실행됨
  })

  it('sort를 buildBrowse에 그대로 넘긴다', async () => {
    const calls = { execute: [] as unknown[][], build: [] as unknown[][], scoped: 0 }
    await new DataCapabilityExecutor().execute(
      makeInput({ operation: { kind: 'data', op: 'browse', schema: 'public', table: 'users', sort: { column: 'id', direction: 'desc' } } }, calls),
    )
    expect(calls.build[0]?.[2]).toEqual({ column: 'id', direction: 'desc' })
  })

  it('apply 요청을 applyChanges로 보내고 applied payload를 준다', async () => {
    const applied: unknown[][] = []
    const driver = {
      id: 'c', engine: 'postgres',
      connect: () => Promise.resolve(), disconnect: () => Promise.resolve(), ping: () => Promise.resolve(1),
      sql: { execute: () => Promise.resolve(), classify: () => 'read' as const },
      data: {
        buildBrowse: () => ({ sql: '', params: [] }),
        applyChanges: (_ctx: unknown, schema: string, table: string, changes: unknown[]) => {
          applied.push([schema, table, changes.length])
          return Promise.resolve({ affected: changes.length })
        },
      },
    } as unknown as import('@main/core/driver/Driver').Driver
    const out = await new DataCapabilityExecutor().execute({
      ctx: { requestId: 'r', signal: new AbortController().signal },
      driver,
      operation: { kind: 'data', op: 'apply', schema: 'public', table: 't', changes: [{ op: 'delete', pk: { id: { t: 'int', v: 1 } } }] },
      page: { cursor: null, maxRows: 10, maxBytes: 10 }, limits: { timeoutMs: 1, maxRows: 1, maxBytes: 1 }, readOnlyScope: false,
    })
    expect(out).toEqual({ kind: 'applied', affected: 1 })
    expect(applied).toEqual([['public', 't', 1]])
  })
})
