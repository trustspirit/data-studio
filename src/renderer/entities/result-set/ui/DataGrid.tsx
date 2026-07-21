import { useRef } from 'react'
import styled from 'styled-components'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { ColumnDescriptor } from '@shared/types/resultSet'
import type { WireValue } from '@shared/types/wire'
import type { BrowseSort } from '@shared/types/operation'
import { renderCell } from '../renderers'

const ROW_HEIGHT = 28

const Scroll = styled.div`
  overflow: auto;
  height: 100%;
  background: ${({ theme }) => theme.color.gridBg};
  font: ${({ theme }) => theme.font.ui};
  font-size: 13px;
`
const HeaderRow = styled.div`
  display: flex;
  position: sticky;
  top: 0;
  background: ${({ theme }) => theme.color.gridHeader};
  border-bottom: 1px solid ${({ theme }) => theme.color.border};
  color: ${({ theme }) => theme.color.textDim};
`
const HeaderCell = styled.div`
  flex: 1 0 120px;
  padding: ${({ theme }) => theme.density.rowPad};
  font-weight: 600;
`
const Cell = styled.div`
  flex: 1 0 120px;
  padding: ${({ theme }) => theme.density.rowPad};
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
`

interface Props {
  columns: readonly ColumnDescriptor[]
  rows: readonly (readonly WireValue[])[]
  hasMore?: boolean
  onLoadMore?: () => void
  sort?: BrowseSort
  onHeaderClick?: (column: string) => void
}

export function DataGrid({ columns, rows, hasMore = false, onLoadMore, sort, onHeaderClick }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  })

  const onScroll = () => {
    const el = scrollRef.current
    if (el === null || !hasMore || onLoadMore === undefined) return
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - ROW_HEIGHT * 4) onLoadMore()
  }

  const items = virtualizer.getVirtualItems()
  return (
    <Scroll ref={scrollRef} data-grid-scroll onScroll={onScroll}>
      <HeaderRow>
        {columns.map((c, i) => {
          const dir = sort?.column === c.name ? (sort.direction === 'desc' ? ' ▼' : ' ▲') : ''
          return (
            <HeaderCell
              key={i}
              style={onHeaderClick ? { cursor: 'pointer' } : undefined}
              onClick={onHeaderClick ? () => onHeaderClick(c.name) : undefined}
            >
              {c.name}{dir}
            </HeaderCell>
          )
        })}
      </HeaderRow>
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {items.map((item) => {
          const row = rows[item.index]
          if (row === undefined) return null
          return (
            <div
              key={item.key}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                transform: `translateY(${item.start}px)`,
                display: 'flex',
              }}
            >
              {row.map((value, ci) => (
                <Cell key={ci} data-cell>
                  {renderCell(value)}
                </Cell>
              ))}
            </div>
          )
        })}
      </div>
    </Scroll>
  )
}
