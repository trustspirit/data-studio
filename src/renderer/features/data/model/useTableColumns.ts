import { useEffect, useRef, useState } from 'react'
import type { ColumnInfo } from '../../../../shared/types/schema'
import type { OperationGateway } from '../../../gateways/ports/OperationGateway'
import type { TableSelection } from '../../../entities/schema-tree'

export interface TableColumnsState {
  readonly columns: readonly ColumnInfo[]
  readonly pkColumns: readonly string[]
  readonly error: string | null
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : 'unknown error'
}

export function useTableColumns(
  gateway: OperationGateway,
  connectionId: string,
  selection: TableSelection | null,
): TableColumnsState {
  const [columns, setColumns] = useState<readonly ColumnInfo[]>([])
  const [pkColumns, setPkColumns] = useState<readonly string[]>([])
  const [error, setError] = useState<string | null>(null)
  const mounted = useRef(true)
  const latest = useRef(0)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const schema = selection?.schema ?? null
  const table = selection?.table ?? null

  useEffect(() => {
    const token = latest.current + 1
    latest.current = token
    setError(null)
    if (schema === null || table === null) { setColumns([]); setPkColumns([]); return }
    void (async () => {
      try {
        const outcome = await gateway.run({
          requestId: crypto.randomUUID(),
          connectionId,
          operation: { kind: 'schema', op: 'describeTable', schema, table },
        })
        if (token !== latest.current || !mounted.current) return
        if (outcome.ok && outcome.payload.kind === 'tableDetail') {
          const cols = outcome.payload.detail.columns
          setColumns(cols)
          setPkColumns(
            cols
              .filter((c) => c.primaryKeyOrdinal !== null)
              .slice()
              .sort((a, b) => (a.primaryKeyOrdinal as number) - (b.primaryKeyOrdinal as number))
              .map((c) => c.name),
          )
        } else if (!outcome.ok) {
          setError(outcome.reason)
        }
      } catch (e) {
        if (token === latest.current && mounted.current) setError(messageOf(e))
      }
    })()
  }, [gateway, connectionId, schema, table])

  return { columns, pkColumns, error }
}
