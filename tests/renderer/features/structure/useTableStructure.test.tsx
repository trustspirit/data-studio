// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { OperationGateway, OperationOutcome } from '@renderer/gateways/ports/OperationGateway'
import {
  useTableStructure,
  type TableSelection,
} from '@renderer/features/structure/model/useTableStructure'

function payloadFor(op: string, table: string): OperationOutcome {
  if (op === 'describeTable')
    return {
      ok: true,
      payload: {
        kind: 'tableDetail',
        detail: {
          schema: 'public',
          name: table,
          columns: [
            { name: 'id', type: 'int8', nullable: false, defaultValue: null, primaryKeyOrdinal: 1 },
          ],
        },
      },
    }
  if (op === 'listIndexes')
    return {
      ok: true,
      payload: {
        kind: 'indexes',
        indexes: [{ name: `${table}_pkey`, columns: ['id'], unique: true, sizeBytes: 8192 }],
      },
    }
  return {
    ok: true,
    payload: {
      kind: 'foreignKeys',
      foreignKeys: [
        {
          name: `${table}_fk`,
          columns: ['owner_id'],
          referencedSchema: 'public',
          referencedTable: 'users',
          referencedColumns: ['id'],
        },
      ],
    },
  }
}

function gateway(): OperationGateway {
  return {
    run: vi.fn((req: { operation: { op: string; table?: string } }) =>
      Promise.resolve(payloadFor(req.operation.op, req.operation.table ?? '?')),
    ),
    cancel: vi.fn().mockResolvedValue(undefined),
    recentAudit: vi.fn().mockResolvedValue([]),
  }
}

const SEL: TableSelection = { schema: 'public', table: 'orders' }

describe('useTableStructure', () => {
  it('선택이 없으면 아무것도 로드하지 않는다', () => {
    const gw = gateway()
    const { result } = renderHook(() => useTableStructure(gw, 'c1', null))
    expect(result.current.columns).toHaveLength(0)
    // eslint-disable-next-line @typescript-eslint/unbound-method -- vi.fn mock
    expect(vi.mocked(gw.run)).not.toHaveBeenCalled()
  })

  it('선택된 테이블의 컬럼·인덱스·외래키를 모두 로드한다', async () => {
    const gw = gateway()
    const { result } = renderHook(() => useTableStructure(gw, 'c1', SEL))
    await waitFor(() => expect(result.current.columns).toHaveLength(1))
    expect(result.current.indexes[0]?.name).toBe('orders_pkey')
    expect(result.current.foreignKeys[0]?.referencedTable).toBe('users')
    expect(result.current.loading).toBe(false)
  })

  it('한 op이라도 실패하면 오류를 노출한다', async () => {
    const gw: OperationGateway = {
      run: vi.fn((req: { operation: { op: string } }) =>
        Promise.resolve(
          req.operation.op === 'listIndexes'
            ? ({ ok: false, reason: 'index read failed' } as OperationOutcome)
            : payloadFor(req.operation.op, 'orders'),
        ),
      ),
      cancel: vi.fn().mockResolvedValue(undefined),
      recentAudit: vi.fn().mockResolvedValue([]),
    }
    const { result } = renderHook(() => useTableStructure(gw, 'c1', SEL))
    await waitFor(() => expect(result.current.error).toBe('index read failed'))
  })

  it('선택이 바뀌면 이전 선택의 결과로 덮어쓰지 않는다', async () => {
    // 느린 첫 응답이 두 번째 선택 뒤에 도착해도 최신 선택만 반영해야 한다.
    const { result, rerender } = renderHook(
      ({ sel }: { sel: TableSelection }) => useTableStructure(gateway(), 'c1', sel),
      { initialProps: { sel: { schema: 'public', table: 'orders' } } },
    )
    await waitFor(() => expect(result.current.foreignKeys[0]?.name).toBe('orders_fk'))
    rerender({ sel: { schema: 'public', table: 'items' } })
    await waitFor(() => expect(result.current.foreignKeys[0]?.name).toBe('items_fk'))
  })
})
