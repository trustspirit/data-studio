// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { OperationGateway, OperationOutcome } from '@renderer/gateways/ports/OperationGateway'
import { useTableColumns } from '@renderer/features/data/model/useTableColumns'
import type { TableSelection } from '@renderer/entities/schema-tree'

const SEL: TableSelection = { schema: 'public', table: 'users' }
function gw(outcome: OperationOutcome): OperationGateway {
  return { run: vi.fn().mockResolvedValue(outcome) as OperationGateway['run'], cancel: vi.fn().mockResolvedValue(undefined), recentAudit: vi.fn().mockResolvedValue([]) }
}

describe('useTableColumns', () => {
  it('describeTable로 컬럼과 PK 컬럼(ordinal 순)을 준다', async () => {
    const g = gw({ ok: true, payload: { kind: 'tableDetail', detail: {
      schema: 'public', name: 'users', columns: [
        { name: 'id', type: 'int8', nullable: false, defaultValue: null, primaryKeyOrdinal: 1 },
        { name: 'email', type: 'text', nullable: false, defaultValue: null, primaryKeyOrdinal: null },
        { name: 'org', type: 'int8', nullable: false, defaultValue: null, primaryKeyOrdinal: 2 },
      ] } } })
    const { result } = renderHook(() => useTableColumns(g, 'c1', SEL))
    await waitFor(() => expect(result.current.columns).toHaveLength(3))
    // ordinal 순: id(1), org(2)
    expect(result.current.pkColumns).toEqual(['id', 'org'])
  })

  it('선택이 없으면 조회하지 않는다', () => {
    const g = gw({ ok: true, payload: { kind: 'tableDetail', detail: { schema: '', name: '', columns: [] } } })
    const { result } = renderHook(() => useTableColumns(g, 'c1', null))
    expect(result.current.pkColumns).toHaveLength(0)
    // eslint-disable-next-line @typescript-eslint/unbound-method -- vi.fn mock
    expect(vi.mocked(g.run)).not.toHaveBeenCalled()
  })

  it('ok:false면 오류를 노출한다', async () => {
    const { result } = renderHook(() => useTableColumns(gw({ ok: false, reason: 'nope' }), 'c1', SEL))
    await waitFor(() => expect(result.current.error).toBe('nope'))
  })
})
