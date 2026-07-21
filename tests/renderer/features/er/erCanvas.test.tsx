// tests/renderer/features/er/erCanvas.test.tsx
// @vitest-environment jsdom
import { render, screen, fireEvent } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { ThemeProvider, darkTheme } from '@renderer/shared/theme'
import { ErCanvas } from '@renderer/features/er/ui/ErCanvas'
import { layoutGraph } from '@renderer/features/er/model/layoutGraph'
import type { GraphNode, GraphEdge } from '@renderer/features/er/model/types'

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ width: 800, height: 400, top: 0, left: 0, right: 800, bottom: 400, x: 0, y: 0, toJSON() {} }),
  })
})

const nodes: GraphNode[] = [
  { table: 'orders', columns: [
    { name: 'id', type: 'int8', isPrimaryKey: true, isForeignKey: false },
    { name: 'user_id', type: 'int8', isPrimaryKey: false, isForeignKey: true },
  ] },
  { table: 'users', columns: [{ name: 'id', type: 'int8', isPrimaryKey: true, isForeignKey: false }] },
]
const edges: GraphEdge[] = [{ fromTable: 'orders', fromColumn: 'user_id', toTable: 'users', toColumn: 'id' }]

function wrap(onOpen = vi.fn()) {
  const graph = layoutGraph(nodes, edges)
  render(
    <ThemeProvider theme={darkTheme}>
      <ErCanvas graph={graph} onOpenTable={onOpen} />
    </ThemeProvider>,
  )
  return onOpen
}

describe('ErCanvas', () => {
  it('노드 이름과 컬럼 행을 렌더한다', () => {
    wrap()
    expect(screen.getByText('orders')).toBeTruthy()
    expect(screen.getByText('users')).toBeTruthy()
    expect(screen.getByText(/user_id/)).toBeTruthy()
  })

  it('엣지 수만큼 path를 그린다', () => {
    wrap()
    // 엣지 path에 마커를 붙였다 — marker-end로 식별
    const paths = document.querySelectorAll('path[marker-end]')
    expect(paths).toHaveLength(1)
  })

  it('노드를 클릭하면 onOpenTable(table)을 호출한다', () => {
    const onOpen = wrap()
    fireEvent.click(screen.getByText('orders'))
    expect(onOpen).toHaveBeenCalledWith('orders')
  })

  it('휠로 줌하면 뷰포트 transform이 바뀐다', () => {
    wrap()
    const vp = document.querySelector('[data-er-viewport]')!
    const before = vp.getAttribute('transform')
    fireEvent.wheel(document.querySelector('[data-er-svg]')!, { deltaY: -100 })
    expect(vp.getAttribute('transform')).not.toBe(before)
  })

  it('배경 드래그로 팬하면 translate가 바뀐다', () => {
    wrap()
    const svg = document.querySelector('[data-er-svg]')!
    const vp = document.querySelector('[data-er-viewport]')!
    const before = vp.getAttribute('transform')
    fireEvent.mouseDown(svg, { clientX: 100, clientY: 100 })
    fireEvent.mouseMove(svg, { clientX: 160, clientY: 130 })
    expect(vp.getAttribute('transform')).not.toBe(before)
  })
})
