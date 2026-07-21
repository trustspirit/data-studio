import { useRef, useState } from 'react'
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
const CellInput = styled.input`
  width: 100%;
  box-sizing: border-box;
  font: inherit;
  background: ${({ theme }) => theme.color.gridBg};
  color: inherit;
  border: 1px solid ${({ theme }) => theme.color.border};
`
const DeleteToggleCell = styled.div`
  flex: 0 0 28px;
  display: flex;
  align-items: center;
  justify-content: center;
`

export interface EditingProps {
  onCommitCell: (rowIndex: number, column: string, text: string) => void
  deletedRows: ReadonlySet<number>
  onToggleDelete: (rowIndex: number) => void
}

interface Props {
  columns: readonly ColumnDescriptor[]
  rows: readonly (readonly WireValue[])[]
  hasMore?: boolean
  onLoadMore?: () => void
  sort?: BrowseSort
  onHeaderClick?: (column: string) => void
  editing?: EditingProps
}

/**
 * 편집 인풋의 초기값용 원시 문자열. renderCell(ReactNode, 스타일 포함)을 재사용하지
 * 않고 값의 원문만 뽑는다 — v1이라 서식은 버리고 사용자가 새로 입력하게 한다.
 */
function rawCellText(value: WireValue): string {
  if (value.t === 'null') return ''
  return String(value.v)
}

export function DataGrid({
  columns,
  rows,
  hasMore = false,
  onLoadMore,
  sort,
  onHeaderClick,
  editing,
}: Props) {
  const [editingCell, setEditingCell] = useState<{ row: number; col: number } | null>(null)
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
        {editing !== undefined && <DeleteToggleCell aria-hidden />}
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
          const rowIndex = item.index
          const deleted = editing?.deletedRows.has(rowIndex) ?? false
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
                opacity: deleted ? 0.4 : undefined,
                textDecoration: deleted ? 'line-through' : undefined,
              }}
            >
              {editing !== undefined && (
                <DeleteToggleCell>
                  <input
                    type="checkbox"
                    checked={deleted}
                    aria-label={`행 ${rowIndex} 삭제`}
                    onChange={() => editing.onToggleDelete(rowIndex)}
                  />
                </DeleteToggleCell>
              )}
              {row.map((value, ci) => {
                const isEditingThisCell =
                  editingCell !== null && editingCell.row === rowIndex && editingCell.col === ci
                if (editing !== undefined && isEditingThisCell) {
                  return (
                    <Cell key={ci} data-cell>
                      <CellInput
                        autoFocus
                        defaultValue={rawCellText(value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            const column = columns[ci]
                            if (column !== undefined) {
                              editing.onCommitCell(rowIndex, column.name, e.currentTarget.value)
                            }
                            setEditingCell(null)
                          } else if (e.key === 'Escape') {
                            setEditingCell(null)
                          }
                        }}
                        onBlur={() => setEditingCell(null)}
                      />
                    </Cell>
                  )
                }
                return (
                  <Cell
                    key={ci}
                    data-cell
                    onDoubleClick={
                      editing !== undefined ? () => setEditingCell({ row: rowIndex, col: ci }) : undefined
                    }
                  >
                    {renderCell(value)}
                  </Cell>
                )
              })}
            </div>
          )
        })}
      </div>
    </Scroll>
  )
}
