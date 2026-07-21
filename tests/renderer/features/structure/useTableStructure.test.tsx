// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
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
    ) as OperationGateway['run'],
    cancel: vi.fn().mockResolvedValue(undefined),
    recentAudit: vi.fn().mockResolvedValue([]),
  }
}

interface Deferred<T> {
  readonly promise: Promise<T>
  resolve: (v: T) => void
}
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
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
      ) as OperationGateway['run'],
      cancel: vi.fn().mockResolvedValue(undefined),
      recentAudit: vi.fn().mockResolvedValue([]),
    }
    const { result } = renderHook(() => useTableStructure(gw, 'c1', SEL))
    await waitFor(() => expect(result.current.error).toBe('index read failed'))
  })

  it('이전 선택의 in-flight 응답이 뒤늦게 도착해도 새 선택을 덮어쓰지 않는다', async () => {
    // orders 선택의 세 응답을 보류시킨 채 items로 전환한다. 보류됐던 orders
    // 응답이 뒤늦게 resolve돼도 latest-wins 가드가 그것을 버려야 한다.
    const gate = deferred<void>()
    const run = vi.fn((req: { operation: { op: string; table?: string } }) => {
      const table = req.operation.table ?? '?'
      if (table === 'orders') {
        return gate.promise.then(() => payloadFor(req.operation.op, 'orders'))
      }
      return Promise.resolve(payloadFor(req.operation.op, table))
    }) as OperationGateway['run']
    const gw: OperationGateway = {
      run,
      cancel: vi.fn().mockResolvedValue(undefined),
      recentAudit: vi.fn().mockResolvedValue([]),
    }
    const { result, rerender } = renderHook(
      ({ sel }: { sel: TableSelection }) => useTableStructure(gw, 'c1', sel),
      { initialProps: { sel: { schema: 'public', table: 'orders' } } },
    )
    // orders 응답은 아직 보류 중 — 두 번째 선택으로 전환.
    rerender({ sel: { schema: 'public', table: 'items' } })
    await waitFor(() => expect(result.current.foreignKeys[0]?.name).toBe('items_fk'))
    // 보류됐던 orders 응답이 이제 도착한다. 가드가 없으면 orders_fk로 덮어써진다.
    await act(async () => {
      gate.resolve()
      await gate.promise
    })
    expect(result.current.foreignKeys[0]?.name).toBe('items_fk')
  })
})
