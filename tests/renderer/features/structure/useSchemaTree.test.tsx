// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { OperationGateway, OperationOutcome } from '@renderer/gateways/ports/OperationGateway'
import { useSchemaTree } from '@renderer/features/structure/model/useSchemaTree'

function gateway(handler: (op: { op: string; schema?: string }) => OperationOutcome): OperationGateway {
  return {
    run: vi.fn((req: { operation: { op: string; schema?: string } }) =>
      Promise.resolve(handler(req.operation)),
    ),
    cancel: vi.fn().mockResolvedValue(undefined),
    recentAudit: vi.fn().mockResolvedValue([]),
  }
}

describe('useSchemaTree', () => {
  it('마운트 시 스키마를 로드한다', async () => {
    const gw = gateway((op) =>
      op.op === 'listSchemas'
        ? { ok: true, payload: { kind: 'schemas', schemas: [{ name: 'public' }, { name: 'sales' }] } }
        : { ok: true, payload: { kind: 'tables', tables: [] } },
    )
    const { result } = renderHook(() => useSchemaTree(gw, 'c1'))
    await waitFor(() => expect(result.current.schemas).toHaveLength(2))
    expect(result.current.schemas[0]?.name).toBe('public')
  })

  it('스키마를 펼치면 그 테이블을 로드해 캐시한다', async () => {
    const gw = gateway((op) => {
      if (op.op === 'listSchemas')
        return { ok: true, payload: { kind: 'schemas', schemas: [{ name: 'public' }] } }
      return {
        ok: true,
        payload: {
          kind: 'tables',
          tables: [{ schema: 'public', name: 'users', kind: 'table', estimatedRows: 10 }],
        },
      }
    })
    const { result } = renderHook(() => useSchemaTree(gw, 'c1'))
    await waitFor(() => expect(result.current.schemas).toHaveLength(1))

    await act(async () => result.current.toggle('public'))
    await waitFor(() => expect(result.current.tablesBySchema['public']).toHaveLength(1))
    expect(result.current.expanded['public']).toBe(true)
    expect(result.current.tablesBySchema['public']?.[0]?.name).toBe('users')

    // 두 번째 토글은 접기만 하고 다시 fetch하지 않는다(캐시).
    // eslint-disable-next-line @typescript-eslint/unbound-method -- vi.fn mock
    const callsBefore = vi.mocked(gw.run).mock.calls.length
    await act(async () => result.current.toggle('public'))
    expect(result.current.expanded['public']).toBe(false)
    // eslint-disable-next-line @typescript-eslint/unbound-method -- vi.fn mock
    expect(vi.mocked(gw.run).mock.calls.length).toBe(callsBefore)
  })

  it('listSchemas가 실패하면 오류를 노출한다', async () => {
    const gw = gateway(() => ({ ok: false, reason: 'not open' }))
    const { result } = renderHook(() => useSchemaTree(gw, 'c1'))
    await waitFor(() => expect(result.current.error).toBe('not open'))
  })

  it('연결이 바뀌면 이전 연결의 테이블 캐시를 버린다', async () => {
    const gw = gateway((op) => {
      if (op.op === 'listSchemas')
        return { ok: true, payload: { kind: 'schemas', schemas: [{ name: 'public' }] } }
      return {
        ok: true,
        payload: {
          kind: 'tables',
          tables: [{ schema: 'public', name: 'users', kind: 'table', estimatedRows: null }],
        },
      }
    })
    const { result, rerender } = renderHook(({ id }: { id: string }) => useSchemaTree(gw, id), {
      initialProps: { id: 'c1' },
    })
    await waitFor(() => expect(result.current.schemas).toHaveLength(1))
    await act(async () => result.current.toggle('public'))
    await waitFor(() => expect(result.current.tablesBySchema['public']).toHaveLength(1))

    // 연결 전환: 캐시 리셋으로 옛 테이블이 사라져야 한다.
    rerender({ id: 'c2' })
    await waitFor(() => expect(result.current.tablesBySchema['public']).toBeUndefined())
    expect(result.current.expanded['public']).toBeUndefined()
  })
})
