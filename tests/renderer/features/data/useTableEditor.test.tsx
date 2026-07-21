// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { OperationGateway } from '@renderer/gateways/ports/OperationGateway'
import { useTableEditor } from '@renderer/features/data/model/useTableEditor'
import type { WireValue } from '@shared/types/wire'

const COLS = ['id', 'name']
const PK = ['id']
const ROWS: readonly (readonly WireValue[])[] = [
  [{ t: 'int', v: 1 }, { t: 'str', v: 'a' }],
  [{ t: 'int', v: 2 }, { t: 'str', v: 'b' }],
]
type AppliedRequest = { operation: { op: string; changes: unknown } }
function gw(run: OperationGateway['run']): OperationGateway {
  return { run, cancel: vi.fn().mockResolvedValue(undefined), recentAudit: vi.fn().mockResolvedValue([]) }
}
function editor(run: OperationGateway['run']) {
  return renderHook(() => useTableEditor(gw(run), 'c1', 'public', 't', COLS, PK, ROWS))
}

describe('useTableEditor', () => {
  it('셀 편집이 dirty를 만들고 save가 원본 PK로 update를 조립한다', async () => {
    const run = vi.fn().mockResolvedValue({ ok: true, payload: { kind: 'applied', affected: 1 } }) as OperationGateway['run']
    const { result } = editor(run)
    act(() => result.current.editCell(0, 'name', 'A'))
    expect(result.current.dirty).toBe(true)
    let ok = false
    await act(async () => { ok = await result.current.save() })
    expect(ok).toBe(true)
    const req = ((run as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [AppliedRequest])[0]
    expect(req.operation.op).toBe('apply')
    expect(req.operation.changes).toEqual([
      { op: 'update', pk: { id: { t: 'int', v: 1 } }, set: { name: { t: 'str', v: 'A' } } },
    ])
  })

  it('행 삭제가 원본 PK로 delete를 조립한다', async () => {
    const run = vi.fn().mockResolvedValue({ ok: true, payload: { kind: 'applied', affected: 1 } }) as OperationGateway['run']
    const { result } = editor(run)
    act(() => result.current.deleteRow(1))
    await act(async () => { await result.current.save() })
    const changes = ((run as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [AppliedRequest])[0].operation.changes
    expect(changes).toContainEqual({ op: 'delete', pk: { id: { t: 'int', v: 2 } } })
  })

  it('새 행이 insert를 조립한다', async () => {
    const run = vi.fn().mockResolvedValue({ ok: true, payload: { kind: 'applied', affected: 1 } }) as OperationGateway['run']
    const { result } = editor(run)
    act(() => result.current.addRow())
    act(() => result.current.editNewCell(0, 'id', '9'))
    act(() => result.current.editNewCell(0, 'name', 'n'))
    await act(async () => { await result.current.save() })
    const changes = ((run as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [AppliedRequest])[0].operation.changes
    expect(changes).toContainEqual({ op: 'insert', values: { id: { t: 'str', v: '9' }, name: { t: 'str', v: 'n' } } })
  })

  it('setNull은 NULL 값으로 편집한다', async () => {
    const run = vi.fn().mockResolvedValue({ ok: true, payload: { kind: 'applied', affected: 1 } }) as OperationGateway['run']
    const { result } = editor(run)
    act(() => result.current.setNull(0, 'name'))
    await act(async () => { await result.current.save() })
    const changes = ((run as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [AppliedRequest])[0].operation.changes
    expect(changes).toEqual([{ op: 'update', pk: { id: { t: 'int', v: 1 } }, set: { name: { t: 'null' } } }])
  })

  it('save 실패면 false·error·스테이징 유지', async () => {
    const run = vi.fn().mockResolvedValue({ ok: false, reason: 'constraint' }) as OperationGateway['run']
    const { result } = editor(run)
    act(() => result.current.editCell(0, 'name', 'A'))
    let ok = true
    await act(async () => { ok = await result.current.save() })
    expect(ok).toBe(false)
    expect(result.current.error).toBe('constraint')
    expect(result.current.dirty).toBe(true) // 유지
  })

  it('discard가 스테이징을 비운다', () => {
    const run = vi.fn() as OperationGateway['run']
    const { result } = editor(run)
    act(() => result.current.editCell(0, 'name', 'A'))
    act(() => result.current.discard())
    expect(result.current.dirty).toBe(false)
  })
})
