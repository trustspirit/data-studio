import { useCallback, useMemo, useRef, useState } from 'react'
import type { RowChange } from '../../../../shared/types/operation'
import type { WireValue } from '../../../../shared/types/wire'
import type { OperationGateway } from '../../../gateways/ports/OperationGateway'

const NULL_VALUE: WireValue = { t: 'null' }

export interface TableEditorState {
  readonly dirty: boolean
  readonly changeCount: number
  readonly edits: ReadonlyMap<number, ReadonlyMap<string, WireValue>>
  readonly newRows: readonly ReadonlyMap<string, WireValue>[]
  readonly deleted: ReadonlySet<number>
  editCell: (rowIndex: number, column: string, text: string) => void
  setNull: (rowIndex: number, column: string) => void
  addRow: () => void
  editNewCell: (newRowIndex: number, column: string, text: string) => void
  setNewCellNull: (newRowIndex: number, column: string) => void
  deleteRow: (rowIndex: number) => void
  discard: () => void
  save: () => Promise<boolean>
  readonly saving: boolean
  readonly error: string | null
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : 'unknown error'
}

export function useTableEditor(
  gateway: OperationGateway,
  connectionId: string,
  schema: string,
  table: string,
  columnNames: readonly string[],
  pkColumns: readonly string[],
  rows: readonly (readonly WireValue[])[],
): TableEditorState {
  const [edits, setEdits] = useState<ReadonlyMap<number, ReadonlyMap<string, WireValue>>>(new Map())
  const [newRows, setNewRows] = useState<readonly ReadonlyMap<string, WireValue>[]>([])
  const [deleted, setDeleted] = useState<ReadonlySet<number>>(new Set())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inFlight = useRef(false)

  const putEdit = useCallback((rowIndex: number, column: string, value: WireValue) => {
    setEdits((prev) => {
      const next = new Map(prev)
      const row = new Map(next.get(rowIndex) ?? new Map<string, WireValue>())
      row.set(column, value)
      next.set(rowIndex, row)
      return next
    })
  }, [])
  const editCell = useCallback((r: number, c: string, text: string) => putEdit(r, c, { t: 'str', v: text }), [putEdit])
  const setNull = useCallback((r: number, c: string) => putEdit(r, c, NULL_VALUE), [putEdit])

  const addRow = useCallback(() => setNewRows((prev) => [...prev, new Map<string, WireValue>()]), [])
  const editNewCell = useCallback((i: number, c: string, text: string) => {
    setNewRows((prev) => {
      const next = prev.map((m) => new Map(m))
      const row = next[i]
      if (row !== undefined) row.set(c, { t: 'str', v: text })
      return next
    })
  }, [])
  const setNewCellNull = useCallback((i: number, c: string) => {
    setNewRows((prev) => {
      const next = prev.map((m) => new Map(m))
      const row = next[i]
      if (row !== undefined) row.set(c, NULL_VALUE)
      return next
    })
  }, [])
  const deleteRow = useCallback((rowIndex: number) => {
    setDeleted((prev) => new Set(prev).add(rowIndex))
  }, [])

  const discard = useCallback(() => {
    setEdits(new Map()); setNewRows([]); setDeleted(new Set()); setError(null)
  }, [])

  const changeCount = edits.size + newRows.length + deleted.size
  const dirty = changeCount > 0

  const buildChanges = useCallback((): RowChange[] => {
    const colIndex = new Map(columnNames.map((c, i) => [c, i]))
    const pkOf = (rowIndex: number): Record<string, WireValue> => {
      const pk: Record<string, WireValue> = {}
      for (const c of pkColumns) {
        const idx = colIndex.get(c)
        if (idx !== undefined) pk[c] = rows[rowIndex]?.[idx] ?? NULL_VALUE
      }
      return pk
    }
    const changes: RowChange[] = []
    // 삭제 → 수정 → 추가 순(제약 충돌을 줄인다).
    for (const rowIndex of deleted) changes.push({ op: 'delete', pk: pkOf(rowIndex) })
    for (const [rowIndex, cols] of edits) {
      if (deleted.has(rowIndex)) continue // 삭제된 행은 수정 무시
      const set: Record<string, WireValue> = {}
      for (const [c, v] of cols) set[c] = v
      if (Object.keys(set).length > 0) changes.push({ op: 'update', pk: pkOf(rowIndex), set })
    }
    for (const row of newRows) {
      const values: Record<string, WireValue> = {}
      for (const [c, v] of row) values[c] = v
      if (Object.keys(values).length > 0) changes.push({ op: 'insert', values })
    }
    return changes
  }, [columnNames, pkColumns, rows, deleted, edits, newRows])

  const save = useCallback(async (): Promise<boolean> => {
    if (inFlight.current) return false
    const changes = buildChanges()
    if (changes.length === 0) return true
    inFlight.current = true
    setSaving(true); setError(null)
    try {
      const outcome = await gateway.run({
        requestId: crypto.randomUUID(),
        connectionId,
        operation: { kind: 'data', op: 'apply', schema, table, changes },
      })
      if (outcome.ok && outcome.payload.kind === 'applied') {
        setEdits(new Map()); setNewRows([]); setDeleted(new Set())
        return true
      }
      setError(outcome.ok ? 'unexpected payload' : outcome.reason)
      return false
    } catch (e) {
      setError(messageOf(e)); return false
    } finally {
      setSaving(false); inFlight.current = false
    }
  }, [gateway, connectionId, schema, table, buildChanges])

  return useMemo(
    () => ({ dirty, changeCount, edits, newRows, deleted, editCell, setNull, addRow, editNewCell, setNewCellNull, deleteRow, discard, save, saving, error }),
    [dirty, changeCount, edits, newRows, deleted, editCell, setNull, addRow, editNewCell, setNewCellNull, deleteRow, discard, save, saving, error],
  )
}
