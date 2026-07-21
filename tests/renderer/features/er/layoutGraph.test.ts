import { describe, expect, it } from 'vitest'
import { layoutGraph, ER_HEADER_H, ER_ROW_H } from '@renderer/features/er/model/layoutGraph'
import type { GraphNode, GraphEdge } from '@renderer/features/er/model/types'

const orders: GraphNode = {
  table: 'orders',
  columns: [
    { name: 'id', type: 'int8', isPrimaryKey: true, isForeignKey: false },
    { name: 'user_id', type: 'int8', isPrimaryKey: false, isForeignKey: true },
  ],
}
const users: GraphNode = {
  table: 'users',
  columns: [{ name: 'id', type: 'int8', isPrimaryKey: true, isForeignKey: false }],
}
const edge: GraphEdge = { fromTable: 'orders', fromColumn: 'user_id', toTable: 'users', toColumn: 'id' }

describe('layoutGraph', () => {
  it('빈 그래프는 빈 결과를 돌려준다', () => {
    expect(layoutGraph([], [])).toEqual({ nodes: [], edges: [], width: 0, height: 0 })
  })

  it('노드 높이는 헤더+행수, 너비는 최장 텍스트로 산출된다', () => {
    const [pn] = layoutGraph([orders], []).nodes
    expect(pn?.height).toBe(ER_HEADER_H + ER_ROW_H * 2)
    expect(pn?.width).toBeGreaterThanOrEqual(120)
    expect(pn?.node.table).toBe('orders')
  })

  it('엣지는 소스 우변·타겟 좌변의 해당 컬럼 행 중앙에 앵커된다', () => {
    const g = layoutGraph([orders, users], [edge])
    const src = g.nodes.find((n) => n.node.table === 'orders')!
    const tgt = g.nodes.find((n) => n.node.table === 'users')!
    const [pe] = g.edges
    expect(pe).toBeDefined()
    // 소스 우변 x
    expect(pe!.from.x).toBeCloseTo(src.left + src.width)
    // user_id는 두 번째 컬럼(idx 1) → 행 중앙 y
    expect(pe!.from.y).toBeCloseTo(src.top + ER_HEADER_H + ER_ROW_H * 1 + ER_ROW_H / 2)
    // 타겟 좌변 x
    expect(pe!.to.x).toBeCloseTo(tgt.left)
    // id는 첫 컬럼(idx 0) → 행 중앙 y
    expect(pe!.to.y).toBeCloseTo(tgt.top + ER_HEADER_H + ER_ROW_H * 0 + ER_ROW_H / 2)
  })

  it('LR 레이아웃에서 소스가 타겟보다 왼쪽에 놓인다', () => {
    const g = layoutGraph([orders, users], [edge])
    const src = g.nodes.find((n) => n.node.table === 'orders')!
    const tgt = g.nodes.find((n) => n.node.table === 'users')!
    expect(src.left).toBeLessThan(tgt.left)
  })

  it('없는 컬럼을 참조하는 엣지는 헤더 중앙으로 폴백한다', () => {
    const ghost: GraphEdge = { fromTable: 'orders', fromColumn: 'ghost', toTable: 'users', toColumn: 'id' }
    const g = layoutGraph([orders, users], [ghost])
    const src = g.nodes.find((n) => n.node.table === 'orders')!
    expect(g.edges[0]!.from.y).toBeCloseTo(src.top + ER_HEADER_H / 2)
  })

  it('양 끝 노드가 다 있지 않은 엣지는 버린다', () => {
    const dangling: GraphEdge = { fromTable: 'orders', fromColumn: 'user_id', toTable: 'ghost', toColumn: 'id' }
    expect(layoutGraph([orders], [dangling]).edges).toHaveLength(0)
  })
})
