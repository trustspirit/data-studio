// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { OperationGateway, OperationOutcome } from '@renderer/gateways/ports/OperationGateway'
import { useSchemaGraph } from '@renderer/features/er/model/useSchemaGraph'

function tables(names: string[]): OperationOutcome {
  return {
    ok: true,
    payload: { kind: 'tables', tables: names.map((name) => ({ schema: 'public', name, kind: 'table', estimatedRows: null })) },
  }
}
function detail(table: string, cols: { name: string; pk?: boolean }[]): OperationOutcome {
  return {
    ok: true,
    payload: {
      kind: 'tableDetail',
      detail: {
        schema: 'public',
        name: table,
        columns: cols.map((c, i) => ({
          name: c.name, type: 'int8', nullable: false, defaultValue: null,
          primaryKeyOrdinal: c.pk === true ? i + 1 : null,
        })),
      },
    },
  }
}
function fks(list: { columns: string[]; refSchema?: string; refTable: string; refColumns: string[] }[]): OperationOutcome {
  return {
    ok: true,
    payload: {
      kind: 'foreignKeys',
      foreignKeys: list.map((f, i) => ({
        name: `fk_${i}`, columns: f.columns, referencedSchema: f.refSchema ?? 'public',
        referencedTable: f.refTable, referencedColumns: f.refColumns,
      })),
    },
  }
}

// orders(id pk, user_id fk→users.id, ext_id fk→other.x), users(id pk)
function makeGateway(over?: (op: string, table?: string) => OperationOutcome | null): OperationGateway {
  const base = (op: string, table?: string): OperationOutcome => {
    if (op === 'listTables') return tables(['orders', 'users'])
    if (op === 'describeTable')
      return table === 'orders'
        ? detail('orders', [{ name: 'id', pk: true }, { name: 'user_id' }, { name: 'ext_id' }])
        : detail('users', [{ name: 'id', pk: true }])
    // listForeignKeys
    return table === 'orders'
      ? fks([
          { columns: ['user_id'], refTable: 'users', refColumns: ['id'] },
          { columns: ['ext_id'], refSchema: 'other', refTable: 'x', refColumns: ['id'] },
        ])
      : fks([])
  }
  return {
    run: vi.fn((req: { operation: { op: string; table?: string } }) => {
      const o = over?.(req.operation.op, req.operation.table)
      return Promise.resolve(o ?? base(req.operation.op, req.operation.table))
    }) as OperationGateway['run'],
    cancel: vi.fn().mockResolvedValue(undefined),
    recentAudit: vi.fn().mockResolvedValue([]),
  }
}

describe('useSchemaGraph', () => {
  it('schema가 null이면 아무것도 로드하지 않는다', () => {
    const gw = makeGateway()
    const { result } = renderHook(() => useSchemaGraph(gw, 'c1', null))
    expect(result.current.nodes).toHaveLength(0)
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(vi.mocked(gw.run)).not.toHaveBeenCalled()
  })

  it('노드와 엣지를 조립하고 PK/FK를 표시한다', async () => {
    const { result } = renderHook(() => useSchemaGraph(makeGateway(), 'c1', 'public'))
    await waitFor(() => expect(result.current.nodes).toHaveLength(2))
    const orders = result.current.nodes.find((n) => n.table === 'orders')!
    expect(orders.columns.find((c) => c.name === 'id')!.isPrimaryKey).toBe(true)
    expect(orders.columns.find((c) => c.name === 'user_id')!.isForeignKey).toBe(true)
    expect(orders.columns.find((c) => c.name === 'user_id')!.isPrimaryKey).toBe(false)
  })

  it('스키마 내부 FK만 엣지로 남기고 타 스키마 FK는 버린다', async () => {
    const { result } = renderHook(() => useSchemaGraph(makeGateway(), 'c1', 'public'))
    await waitFor(() => expect(result.current.nodes).toHaveLength(2))
    expect(result.current.edges).toHaveLength(1)
    expect(result.current.edges[0]).toMatchObject({ fromTable: 'orders', fromColumn: 'user_id', toTable: 'users', toColumn: 'id' })
  })

  it('일부 테이블 fetch 실패는 fail-soft — 성공분은 렌더하고 error를 노출한다', async () => {
    const gw = makeGateway((op, table) =>
      op === 'describeTable' && table === 'users' ? ({ ok: false, reason: 'describe users failed' } as OperationOutcome) : null,
    )
    const { result } = renderHook(() => useSchemaGraph(gw, 'c1', 'public'))
    await waitFor(() => expect(result.current.error).toBe('describe users failed'))
    // orders는 남고, users 노드가 없으므로 orders→users 엣지도 버려진다
    expect(result.current.nodes.map((n) => n.table)).toEqual(['orders'])
    expect(result.current.edges).toHaveLength(0)
  })

  it('listTables 자체가 실패하면 error만 세우고 노드는 비운다', async () => {
    const gw = makeGateway((op) => (op === 'listTables' ? ({ ok: false, reason: 'no tables' } as OperationOutcome) : null))
    const { result } = renderHook(() => useSchemaGraph(gw, 'c1', 'public'))
    await waitFor(() => expect(result.current.error).toBe('no tables'))
    expect(result.current.nodes).toHaveLength(0)
  })

  it('스키마 변경 시 이전 스키마의 뒤늦은 응답이 새 결과를 덮어쓰지 않는다', async () => {
    // 'slow' 스키마의 listTables를 보류시킨 채 'fast'로 전환한다. 보류됐던
    // 'slow' 응답이 뒤늦게 resolve돼도 latest-token 가드가 그것을 버려야 한다.
    let releaseSlow!: () => void
    const slowGate = new Promise<void>((r) => {
      releaseSlow = r
    })
    const single = (op: string, table: string): OperationOutcome => {
      if (op === 'listTables') return tables([table])
      if (op === 'describeTable') return detail(table, [{ name: 'id', pk: true }])
      return fks([])
    }
    const gw: OperationGateway = {
      run: vi.fn((req: { operation: { op: string; schema?: string; table?: string } }) => {
        const schema = req.operation.schema
        // 각 스키마는 자기 이름과 같은 이름의 테이블 하나를 돌려준다.
        const t = schema === 'slow' ? 'slow_tbl' : 'fast_tbl'
        const resolved = single(req.operation.op, req.operation.table ?? t)
        if (schema === 'slow' && req.operation.op === 'listTables') {
          return slowGate.then(() => resolved)
        }
        return Promise.resolve(resolved)
      }) as OperationGateway['run'],
      cancel: vi.fn().mockResolvedValue(undefined),
      recentAudit: vi.fn().mockResolvedValue([]),
    }
    const { result, rerender } = renderHook(({ schema }: { schema: string }) => useSchemaGraph(gw, 'c1', schema), {
      initialProps: { schema: 'slow' },
    })
    // slow의 listTables는 아직 보류 중 — fast로 전환.
    rerender({ schema: 'fast' })
    await waitFor(() => expect(result.current.nodes.map((n) => n.table)).toEqual(['fast_tbl']))
    // 보류됐던 slow 응답이 이제 도착한다. 가드가 없으면 slow_tbl로 덮어써진다.
    await act(async () => {
      releaseSlow()
      await slowGate
    })
    expect(result.current.nodes.map((n) => n.table)).toEqual(['fast_tbl'])
  })
})
