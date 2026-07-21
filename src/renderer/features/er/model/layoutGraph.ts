// src/renderer/features/er/model/layoutGraph.ts
import dagre from '@dagrejs/dagre'
import type {
  GraphNode,
  GraphEdge,
  PositionedGraph,
  PositionedNode,
  PositionedEdge,
} from './types'

export const ER_HEADER_H = 26
export const ER_ROW_H = 20
const CHAR_W = 7
const PAD_X = 12
const MIN_W = 120
const MAX_W = 280
const MARGIN = 20

function clamp(min: number, max: number, v: number): number {
  return Math.max(min, Math.min(max, v))
}

function nodeSize(node: GraphNode): { width: number; height: number } {
  const texts = [node.table, ...node.columns.map((c) => `${c.name} ${c.type}`)]
  const maxLen = texts.reduce((m, t) => Math.max(m, t.length), 0)
  const width = clamp(MIN_W, MAX_W, maxLen * CHAR_W + PAD_X * 2)
  const height = ER_HEADER_H + ER_ROW_H * node.columns.length
  return { width, height }
}

function rowCenterY(pn: PositionedNode, colName: string): number {
  const idx = pn.node.columns.findIndex((c) => c.name === colName)
  if (idx < 0) return pn.top + ER_HEADER_H / 2
  return pn.top + ER_HEADER_H + ER_ROW_H * idx + ER_ROW_H / 2
}

export function layoutGraph(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
): PositionedGraph {
  if (nodes.length === 0) return { nodes: [], edges: [], width: 0, height: 0 }

  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: 'LR', nodesep: 40, ranksep: 80, marginx: MARGIN, marginy: MARGIN })
  g.setDefaultEdgeLabel(() => ({}))

  const sizes = new Map<string, { width: number; height: number }>()
  for (const node of nodes) {
    const size = nodeSize(node)
    sizes.set(node.table, size)
    g.setNode(node.table, { width: size.width, height: size.height })
  }
  for (const edge of edges) {
    if (sizes.has(edge.fromTable) && sizes.has(edge.toTable)) g.setEdge(edge.fromTable, edge.toTable)
  }
  dagre.layout(g)

  const byTable = new Map<string, PositionedNode>()
  const positioned: PositionedNode[] = []
  for (const node of nodes) {
    const size = sizes.get(node.table)
    if (size === undefined) continue
    const dn = g.node(node.table) as { x: number; y: number }
    const pn: PositionedNode = {
      node,
      left: dn.x - size.width / 2,
      top: dn.y - size.height / 2,
      width: size.width,
      height: size.height,
    }
    positioned.push(pn)
    byTable.set(node.table, pn)
  }

  const positionedEdges: PositionedEdge[] = []
  for (const edge of edges) {
    const src = byTable.get(edge.fromTable)
    const tgt = byTable.get(edge.toTable)
    if (src === undefined || tgt === undefined) continue
    positionedEdges.push({
      edge,
      from: { x: src.left + src.width, y: rowCenterY(src, edge.fromColumn) },
      to: { x: tgt.left, y: rowCenterY(tgt, edge.toColumn) },
    })
  }

  let width = 0
  let height = 0
  for (const pn of positioned) {
    width = Math.max(width, pn.left + pn.width)
    height = Math.max(height, pn.top + pn.height)
  }
  return { nodes: positioned, edges: positionedEdges, width: width + MARGIN, height: height + MARGIN }
}
