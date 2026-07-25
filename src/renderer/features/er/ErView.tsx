import { useEffect, useMemo, useState } from 'react'
import styled from 'styled-components'
import type { OperationGateway } from '../../gateways/ports/OperationGateway'
import { ErrorBanner, Toolbar } from '../../shared/ui'
import { useSchemaGraph } from './model/useSchemaGraph'
import { layoutGraph } from './model/layoutGraph'
import { ErCanvas } from './ui/ErCanvas'
import { SchemaSelect } from './ui/SchemaSelect'

const Layout = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: ${({ theme }) => theme.color.winBg};
  color: ${({ theme }) => theme.color.text};
`
const Dim = styled.span`
  font-family: ${({ theme }) => theme.font.ui};
  font-size: ${({ theme }) => theme.fontSize.sm};
  color: ${({ theme }) => theme.color.textDim};
`
const Body = styled.div`
  flex: 1;
  min-height: 0;
`
const Empty = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: ${({ theme }) => theme.color.textDim};
  font-family: ${({ theme }) => theme.font.ui};
  font-size: ${({ theme }) => theme.fontSize.md};
`

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : 'unknown error'
}

interface Props {
  gateway: OperationGateway
  connectionId: string
  onOpenTable: (schema: string, table: string) => void
}

export function ErView({ gateway, connectionId, onOpenTable }: Props) {
  const [schemas, setSchemas] = useState<readonly string[]>([])
  const [schema, setSchema] = useState<string | null>(null)
  const [schemasError, setSchemasError] = useState<string | null>(null)

  useEffect(() => {
    setSchema(null)
    setSchemas([])
    setSchemasError(null)
    let cancelled = false
    void (async () => {
      try {
        const out = await gateway.run({
          requestId: crypto.randomUUID(),
          connectionId,
          operation: { kind: 'schema', op: 'listSchemas' },
        })
        if (cancelled) return
        if (out.ok && out.payload.kind === 'schemas') setSchemas(out.payload.schemas.map((s) => s.name))
        else if (!out.ok) setSchemasError(out.reason)
      } catch (e) {
        if (!cancelled) setSchemasError(messageOf(e))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [gateway, connectionId])

  const graph = useSchemaGraph(gateway, connectionId, schema)
  const positioned = useMemo(() => layoutGraph(graph.nodes, graph.edges), [graph.nodes, graph.edges])

  return (
    <Layout>
      <Toolbar>
        <SchemaSelect schemas={schemas} value={schema} onChange={setSchema} />
        {graph.loading && <Dim>불러오는 중…</Dim>}
      </Toolbar>
      {schemasError !== null && <ErrorBanner>{schemasError}</ErrorBanner>}
      {graph.error !== null && <ErrorBanner>{graph.error}</ErrorBanner>}
      <Body>
        {schema === null ? (
          <Empty>스키마를 선택하세요</Empty>
        ) : graph.nodes.length === 0 && !graph.loading ? (
          <Empty>테이블 없음</Empty>
        ) : (
          <ErCanvas graph={positioned} onOpenTable={(table) => onOpenTable(schema, table)} />
        )}
      </Body>
    </Layout>
  )
}
