import { useCallback, useEffect, useState } from 'react'
import type { SchemaInfo, TableInfo } from '../../../../shared/types/schema'
import type { OperationRequestDto } from '../../../../shared/contracts/operationDto'
import type { OperationGateway } from '../../../gateways/ports/OperationGateway'

export interface SchemaTreeState {
  readonly schemas: readonly SchemaInfo[]
  readonly tablesBySchema: Readonly<Record<string, readonly TableInfo[]>>
  readonly expanded: Readonly<Record<string, boolean>>
  toggle: (schema: string) => void
  readonly error: string | null
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : 'unknown error'
}

export function useSchemaTree(gateway: OperationGateway, connectionId: string): SchemaTreeState {
  const [schemas, setSchemas] = useState<readonly SchemaInfo[]>([])
  const [tablesBySchema, setTablesBySchema] = useState<Record<string, readonly TableInfo[]>>({})
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const request: OperationRequestDto = {
      requestId: crypto.randomUUID(),
      connectionId,
      operation: { kind: 'schema', op: 'listSchemas' },
    }
    void (async () => {
      try {
        const outcome = await gateway.run(request)
        if (cancelled) return
        if (outcome.ok && outcome.payload.kind === 'schemas') setSchemas(outcome.payload.schemas)
        else if (!outcome.ok) setError(outcome.reason)
      } catch (e) {
        if (!cancelled) setError(messageOf(e))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [gateway, connectionId])

  const toggle = useCallback(
    (schema: string) => {
      setExpanded((prev) => ({ ...prev, [schema]: !prev[schema] }))
      setTablesBySchema((prev) => {
        if (prev[schema] !== undefined) return prev // 이미 로드됨 — 다시 fetch 안 함
        void (async () => {
          try {
            const outcome = await gateway.run({
              requestId: crypto.randomUUID(),
              connectionId,
              operation: { kind: 'schema', op: 'listTables', schema },
            })
            if (outcome.ok && outcome.payload.kind === 'tables') {
              setTablesBySchema((cur) => ({ ...cur, [schema]: outcome.payload.tables }))
            } else if (!outcome.ok) {
              setError(outcome.reason)
            }
          } catch (e) {
            setError(messageOf(e))
          }
        })()
        return prev
      })
    },
    [gateway, connectionId],
  )

  return { schemas, tablesBySchema, expanded, toggle, error }
}
