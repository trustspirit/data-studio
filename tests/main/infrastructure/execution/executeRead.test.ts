import { describe, expect, it, vi } from 'vitest'
import { executeRead } from '@main/infrastructure/execution/executeRead'
import type { SqlCapability, ReadOnlyScope } from '@main/core/driver/capabilities/SqlCapability'
import type { ExecutionContext } from '@main/core/driver/ExecutionContext'
import type { PageRequest, ResultSet } from '@shared/types/resultSet'

const ctx: ExecutionContext = { requestId: 'r', signal: new AbortController().signal }
const page: PageRequest = { cursor: null, maxRows: 10, maxBytes: 1000 }
function emptyResult(): ResultSet {
  return {
    requestId: 'r', columns: [], rows: [],
    page: { cursor: null, hasMore: false, rowCount: 0, bytes: 0 },
    meta: { durationMs: 0, truncatedRows: false, truncatedBytes: false, rowsAffected: null },
  }
}

describe('executeRead', () => {
  it('readOnlyScope=false면 직접 execute한다(스코프를 열지 않는다)', async () => {
    const execute = vi.fn().mockResolvedValue(emptyResult())
    const beginReadOnly = vi.fn()
    const sql = { execute, beginReadOnly, classify: () => 'read' } as unknown as SqlCapability
    await executeRead(sql, ctx, 'SELECT 1', page, ['p'], false)
    expect(execute).toHaveBeenCalledWith(ctx, 'SELECT 1', page, ['p'])
    expect(beginReadOnly).not.toHaveBeenCalled()
  })

  it('readOnlyScope=true면 beginReadOnly 스코프 안에서 실행하고 반드시 end한다', async () => {
    const scopeExecute = vi.fn().mockResolvedValue(emptyResult())
    const end = vi.fn().mockResolvedValue(undefined)
    const scope: ReadOnlyScope = { execute: scopeExecute, end }
    const directExecute = vi.fn().mockResolvedValue(emptyResult())
    const sql = {
      execute: directExecute,
      beginReadOnly: vi.fn().mockResolvedValue(scope),
      classify: () => 'read',
    } as unknown as SqlCapability
    await executeRead(sql, ctx, 'SELECT 1', page, undefined, true)
    expect(scopeExecute).toHaveBeenCalledWith(ctx, 'SELECT 1', page, undefined)
    expect(directExecute).not.toHaveBeenCalled() // 스코프 밖 경로로 새지 않는다
    expect(end).toHaveBeenCalledTimes(1)
  })

  it('스코프 실행이 던져도 end한다', async () => {
    const end = vi.fn().mockResolvedValue(undefined)
    const scope: ReadOnlyScope = { execute: vi.fn().mockRejectedValue(new Error('boom')), end }
    const sql = {
      execute: vi.fn(), beginReadOnly: vi.fn().mockResolvedValue(scope), classify: () => 'read',
    } as unknown as SqlCapability
    await expect(executeRead(sql, ctx, 'SELECT 1', page, undefined, true)).rejects.toThrow('boom')
    expect(end).toHaveBeenCalledTimes(1)
  })

  it('readOnlyScope=true인데 beginReadOnly가 없으면 던진다', async () => {
    // 조용히 일반 실행으로 대체하면 AI 읽기 전용 보장이 무너진 채 안전해 보인다.
    const sql = { execute: vi.fn(), classify: () => 'read' } as unknown as SqlCapability
    await expect(executeRead(sql, ctx, 'SELECT 1', page, undefined, true)).rejects.toThrow(/read-only scope/)
  })
})
