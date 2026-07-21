// src/renderer/features/er/model/types.ts
/** ER 그래프의 도메인 타입. IPC를 횡단하지 않으므로 피처 로컬에 둔다. */

export interface GraphColumn {
  readonly name: string
  readonly type: string
  readonly isPrimaryKey: boolean
  readonly isForeignKey: boolean
}
export interface GraphNode {
  readonly table: string
  readonly columns: readonly GraphColumn[]
}
export interface GraphEdge {
  readonly fromTable: string
  readonly fromColumn: string
  readonly toTable: string
  readonly toColumn: string
}
export interface Point {
  readonly x: number
  readonly y: number
}
export interface PositionedNode {
  readonly node: GraphNode
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}
export interface PositionedEdge {
  readonly edge: GraphEdge
  readonly from: Point
  readonly to: Point
}
export interface PositionedGraph {
  readonly nodes: readonly PositionedNode[]
  readonly edges: readonly PositionedEdge[]
  readonly width: number
  readonly height: number
}
