import { useEffect, useRef, useState } from 'react'
import type { OperationGateway } from '../../../gateways/ports/OperationGateway'
import type { GraphColumn, GraphEdge, GraphNode } from './types'

export interface SchemaGraphState {
  readonly nodes: readonly GraphNode[]
  readonly edges: readonly GraphEdge[]
  readonly loading: boolean
  readonly error: string | null
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : 'unknown error'
}

export function useSchemaGraph(
  gateway: OperationGateway,
  connectionId: string,
  schema: string | null,
): SchemaGraphState {
  const [nodes, setNodes] = useState<readonly GraphNode[]>([])
  const [edges, setEdges] = useState<readonly GraphEdge[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const latest = useRef(0)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    if (schema === null) {
      latest.current += 1 // 진행 중이던 이전 응답 무효화
      setNodes([])
      setEdges([])
      setLoading(false)
      setError(null)
      return
    }
    const token = latest.current + 1
    latest.current = token
    setLoading(true)
    setError(null)

    void (async () => {
      try {
        const tablesOutcome = await gateway.run({
          requestId: crypto.randomUUID(),
          connectionId,
          operation: { kind: 'schema', op: 'listTables', schema },
        })
        if (token !== latest.current || !mounted.current) return
        if (!tablesOutcome.ok) {
          setError(tablesOutcome.reason)
          setNodes([])
          setEdges([])
          setLoading(false)
          return
        }
        const tableList = tablesOutcome.payload.kind === 'tables' ? tablesOutcome.payload.tables : []

        const perTable = await Promise.all(
          tableList.map(async (t) => {
            const [detail, fks] = await Promise.all([
              gateway.run({ requestId: crypto.randomUUID(), connectionId, operation: { kind: 'schema', op: 'describeTable', schema, table: t.name } }),
              gateway.run({ requestId: crypto.randomUUID(), connectionId, operation: { kind: 'schema', op: 'listForeignKeys', schema, table: t.name } }),
            ])
            return { table: t.name, detail, fks }
          }),
        )
        if (token !== latest.current || !mounted.current) return

        const nextNodes: GraphNode[] = []
        const rawEdges: GraphEdge[] = []
        let firstError: string | null = null

        for (const { table, detail, fks } of perTable) {
          if (!detail.ok) {
            firstError = firstError ?? detail.reason
            continue
          }
          if (!fks.ok) {
            firstError = firstError ?? fks.reason
            continue
          }
          const columns = detail.payload.kind === 'tableDetail' ? detail.payload.detail.columns : []
          const foreignKeys = fks.payload.kind === 'foreignKeys' ? fks.payload.foreignKeys : []
          const fkColumnNames = new Set(foreignKeys.flatMap((fk) => fk.columns))
          const graphColumns: GraphColumn[] = columns.map((c) => ({
            name: c.name,
            type: c.type,
            isPrimaryKey: c.primaryKeyOrdinal !== null,
            isForeignKey: fkColumnNames.has(c.name),
          }))
          nextNodes.push({ table, columns: graphColumns })
          for (const fk of foreignKeys) {
            const from = fk.columns[0]
            const to = fk.referencedColumns[0]
            if (fk.referencedSchema === schema && from !== undefined && to !== undefined) {
              rawEdges.push({ fromTable: table, fromColumn: from, toTable: fk.referencedTable, toColumn: to })
            }
          }
        }

        // 참조 대상이 실제로 빌드된 노드일 때만 엣지를 남긴다(실패·부재 테이블 참조 제거).
        const built = new Set(nextNodes.map((n) => n.table))
        const nextEdges = rawEdges.filter((e) => built.has(e.toTable))

        setNodes(nextNodes)
        setEdges(nextEdges)
        setError(firstError)
        setLoading(false)
      } catch (e) {
        if (token !== latest.current || !mounted.current) return
        setError(messageOf(e))
        setLoading(false)
      }
    })()
  }, [gateway, connectionId, schema])

  return { nodes, edges, loading, error }
}
