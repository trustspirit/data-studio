// src/renderer/features/er/ui/ErCanvas.tsx
import { useCallback, useEffect, useRef, useState } from 'react'
import styled, { useTheme } from 'styled-components'
import type { PositionedGraph } from '../model/types'
import { ER_HEADER_H, ER_ROW_H } from '../model/layoutGraph'

const MIN_ZOOM = 0.2
const MAX_ZOOM = 2.5

const Wrap = styled.div`
  position: relative;
  height: 100%;
  overflow: hidden;
  background: ${({ theme }) => theme.color.winBg};
`
const Toolbar = styled.div`
  position: absolute;
  top: 8px;
  right: 8px;
  display: flex;
  gap: 4px;
  z-index: 1;
`
const ToolButton = styled.button`
  font: ${({ theme }) => theme.font.ui};
  font-size: 12px;
  padding: 2px 8px;
  border: 1px solid ${({ theme }) => theme.color.border};
  background: ${({ theme }) => theme.color.toolbar};
  color: ${({ theme }) => theme.color.text};
  border-radius: 4px;
  cursor: pointer;
`

interface Props {
  graph: PositionedGraph
  onOpenTable: (table: string) => void
}

export function ErCanvas({ graph, onOpenTable }: Props) {
  const theme = useTheme()
  const wrapRef = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const drag = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null)

  const fit = useCallback(() => {
    const el = wrapRef.current
    if (el === null || graph.width === 0 || graph.height === 0) {
      setZoom(1)
      setPan({ x: 0, y: 0 })
      return
    }
    const rect = el.getBoundingClientRect()
    const z = Math.max(MIN_ZOOM, Math.min(1, rect.width / graph.width, rect.height / graph.height))
    setZoom(z)
    setPan({ x: (rect.width - graph.width * z) / 2, y: (rect.height - graph.height * z) / 2 })
  }, [graph.width, graph.height])

  useEffect(() => {
    fit()
  }, [fit])

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    setZoom((z) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z * (e.deltaY < 0 ? 1.1 : 0.9))))
  }
  const onMouseDown = (e: React.MouseEvent) => {
    drag.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y }
  }
  const onMouseMove = (e: React.MouseEvent) => {
    const d = drag.current
    if (d === null) return
    setPan({ x: d.panX + (e.clientX - d.x), y: d.panY + (e.clientY - d.y) })
  }
  const endDrag = () => {
    drag.current = null
  }

  return (
    <Wrap ref={wrapRef}>
      <Toolbar>
        <ToolButton type="button" aria-label="zoom in" onClick={() => setZoom((z) => Math.min(MAX_ZOOM, z * 1.2))}>
          +
        </ToolButton>
        <ToolButton type="button" aria-label="zoom out" onClick={() => setZoom((z) => Math.max(MIN_ZOOM, z * 0.8))}>
          −
        </ToolButton>
        <ToolButton type="button" onClick={fit}>
          Fit
        </ToolButton>
      </Toolbar>
      <svg
        data-er-svg
        width="100%"
        height="100%"
        onWheel={onWheel}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={endDrag}
        onMouseLeave={endDrag}
        style={{ display: 'block', color: theme.color.textDim }}
      >
        <defs>
          <marker id="er-arrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
            <path d="M0,0 L7,3 L0,6 Z" fill="currentColor" />
          </marker>
        </defs>
        <g data-er-viewport transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
          {graph.edges.map((pe, i) => {
            const dx = Math.max(30, Math.abs(pe.to.x - pe.from.x) / 2)
            const d = `M${pe.from.x},${pe.from.y} C${pe.from.x + dx},${pe.from.y} ${pe.to.x - dx},${pe.to.y} ${pe.to.x},${pe.to.y}`
            return <path key={i} d={d} fill="none" stroke="currentColor" strokeWidth={1} opacity={0.6} markerEnd="url(#er-arrow)" />
          })}
          {graph.nodes.map((pn) => (
            <g
              key={pn.node.table}
              transform={`translate(${pn.left},${pn.top})`}
              style={{ cursor: 'pointer' }}
              onClick={(e) => {
                e.stopPropagation()
                onOpenTable(pn.node.table)
              }}
            >
              <rect
                width={pn.width}
                height={pn.height}
                rx={4}
                fill={theme.color.panel}
                stroke={theme.color.border}
              />
              <line x1={0} y1={ER_HEADER_H} x2={pn.width} y2={ER_HEADER_H} stroke={theme.color.border} />
              <text x={8} y={ER_HEADER_H / 2} dominantBaseline="middle" fontWeight={600} fill={theme.color.text} fontSize={13}>
                {pn.node.table}
              </text>
              {pn.node.columns.map((c, ci) => (
                <text
                  key={c.name}
                  x={8}
                  y={ER_HEADER_H + ER_ROW_H * ci + ER_ROW_H / 2}
                  dominantBaseline="middle"
                  fontSize={12}
                  fill={theme.color.text}
                >
                  {c.isPrimaryKey ? '🔑 ' : c.isForeignKey ? 'FK ' : ''}
                  {c.name} {c.type}
                </text>
              ))}
            </g>
          ))}
        </g>
      </svg>
    </Wrap>
  )
}
