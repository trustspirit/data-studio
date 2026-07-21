import { useEffect, useRef, useState } from 'react'
import type {
  ColumnInfo,
  ForeignKeyInfo,
  IndexInfo,
} from '../../../../shared/types/schema'
import type { OperationGateway, OperationOutcome } from '../../../gateways/ports/OperationGateway'
import type { TableSelection } from '../../../entities/schema-tree'

export interface TableStructureState {
  readonly columns: readonly ColumnInfo[]
  readonly indexes: readonly IndexInfo[]
  readonly foreignKeys: readonly ForeignKeyInfo[]
  readonly loading: boolean
  readonly error: string | null
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : 'unknown error'
}
function reasonOf(outcome: OperationOutcome): string | null {
  return outcome.ok ? null : outcome.reason
}

export function useTableStructure(
  gateway: OperationGateway,
  connectionId: string,
  selection: TableSelection | null,
): TableStructureState {
  const [columns, setColumns] = useState<readonly ColumnInfo[]>([])
  const [indexes, setIndexes] = useState<readonly IndexInfo[]>([])
  const [foreignKeys, setForeignKeys] = useState<readonly ForeignKeyInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const latest = useRef(0)
  const mounted = useRef(true)

  const schema = selection?.schema ?? null
  const table = selection?.table ?? null

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    if (schema === null || table === null) {
      latest.current += 1 // 진행 중이던 이전 선택의 응답을 무효화
      setColumns([])
      setIndexes([])
      setForeignKeys([])
      setLoading(false)
      setError(null)
      return
    }
    const token = latest.current + 1
    latest.current = token
    setLoading(true)
    setError(null)
    const run = (op: 'describeTable' | 'listIndexes' | 'listForeignKeys') =>
      gateway.run({
        requestId: crypto.randomUUID(),
        connectionId,
        operation: { kind: 'schema', op, schema, table },
      })
    void (async () => {
      try {
        const [detail, idx, fks] = await Promise.all([
          run('describeTable'),
          run('listIndexes'),
          run('listForeignKeys'),
        ])
        if (token !== latest.current || !mounted.current) return // 오래된 선택 — 버린다
        const firstFail = reasonOf(detail) ?? reasonOf(idx) ?? reasonOf(fks)
        if (firstFail !== null) {
          setError(firstFail)
          setLoading(false)
          return
        }
        if (detail.ok && detail.payload.kind === 'tableDetail') setColumns(detail.payload.detail.columns)
        if (idx.ok && idx.payload.kind === 'indexes') setIndexes(idx.payload.indexes)
        if (fks.ok && fks.payload.kind === 'foreignKeys') setForeignKeys(fks.payload.foreignKeys)
        setLoading(false)
      } catch (e) {
        if (token !== latest.current || !mounted.current) return
        setError(messageOf(e))
        setLoading(false)
      }
    })()
  }, [gateway, connectionId, schema, table])

  return { columns, indexes, foreignKeys, loading, error }
}
