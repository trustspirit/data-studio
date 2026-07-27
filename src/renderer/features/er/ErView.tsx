import { useMemo } from 'react'
import styled from 'styled-components'
import type { OperationGateway } from '../../gateways/ports/OperationGateway'
import { EmptyState, ErrorBanner, Toolbar } from '../../shared/ui'
import { useSchemaGraph } from './model/useSchemaGraph'
import { layoutGraph } from './model/layoutGraph'
import { ErCanvas } from './ui/ErCanvas'

const Layout = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: ${({ theme }) => theme.color.surface.bg};
  color: ${({ theme }) => theme.color.fg.primary};
`
const Dim = styled.span`
  font-family: ${({ theme }) => theme.font.ui};
  font-size: ${({ theme }) => theme.fontSize.label};
  color: ${({ theme }) => theme.color.fg.dim};
`
const Body = styled.div`
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
`

interface Props {
  gateway: OperationGateway
  connectionId: string
  /** 문서가 확정한 스키마 — ER 문서는 스키마마다 하나씩 열린다. */
  schema: string
  onOpenTable: (schema: string, table: string) => void
}

export function ErView({ gateway, connectionId, schema, onOpenTable }: Props) {
  const graph = useSchemaGraph(gateway, connectionId, schema)
  const positioned = useMemo(() => layoutGraph(graph.nodes, graph.edges), [graph.nodes, graph.edges])

  return (
    <Layout>
      <Toolbar>
        <Dim>{schema}</Dim>
        {graph.loading && <Dim>불러오는 중…</Dim>}
      </Toolbar>
      {graph.error !== null && <ErrorBanner>{graph.error}</ErrorBanner>}
      <Body>
        {graph.nodes.length === 0 && !graph.loading ? (
          <EmptyState title="테이블 없음" />
        ) : (
          <ErCanvas graph={positioned} onOpenTable={(table) => onOpenTable(schema, table)} />
        )}
      </Body>
    </Layout>
  )
}
