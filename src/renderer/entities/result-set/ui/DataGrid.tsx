import { useEffect, useRef, useState } from 'react'
import styled from 'styled-components'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { ColumnDescriptor } from '@shared/types/resultSet'
import type { WireValue } from '@shared/types/wire'
import type { BrowseSort } from '@shared/types/operation'
import { renderCell } from '../renderers'
import { selectionText, type GridPoint } from '../model/gridSelection'

// theme.density.rowHeight와 같은 값이어야 한다. 가상화가 숫자를 요구하므로
// 문자열 토큰을 그대로 쓸 수 없어 상수로 복제돼 있다 — dataGrid.test가 두 값의
// 일치를 단언해 이 복제가 조용히 갈라지는 것을 막는다.
const ROW_HEIGHT = 36

const Scroll = styled.div`
  overflow: auto;
  flex: 1;
  min-height: 0;
  min-width: 0;
  background: ${({ theme }) => theme.color.surface.bg};
  font-family: ${({ theme }) => theme.font.ui};
  font-size: ${({ theme }) => theme.fontSize.label};
  font-variant-numeric: tabular-nums;
`
const Sheet = styled.div`
  width: max-content;
  min-width: 100%;
`
const HeaderRow = styled.div`
  display: flex;
  position: sticky;
  top: 0;
  z-index: 3;
  height: 48px;
  background: ${({ theme }) => theme.color.surface.base};
  border-bottom: 1px solid ${({ theme }) => theme.color.border.strong};
  color: ${({ theme }) => theme.color.text.dim};
  font-size: ${({ theme }) => theme.fontSize.label};
  letter-spacing: 0.3px;
`
const HeaderCell = styled.div`
  position: relative;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  gap: 3px;
  padding: 0 ${({ theme }) => theme.space.md};
  font-weight: 600;
  border-right: 1px solid ${({ theme }) => theme.color.border.soft};
  &[aria-sort='ascending'], &[aria-sort='descending'] {
    background: ${({ theme }) => theme.color.intentSoft.accent};
    color: ${({ theme }) => theme.color.intent.accent};
  }
`
const HeaderLabel = styled.span`
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`
const TypeLabel = styled.small`
  color: ${({ theme }) => theme.color.text.faint};
  font-family: ${({ theme }) => theme.font.mono};
  font-weight: 400;
  font-size: 11px;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`
const ResizeHandle = styled.div`
  position: absolute;
  right: -3px;
  top: 0;
  bottom: 0;
  width: 7px;
  z-index: 1;
  cursor: col-resize;
  touch-action: none;
  &:hover, &:focus-visible { background: ${({ theme }) => theme.color.intent.accent}; }
`
const Gutter = styled.div`
  position: sticky;
  left: 0;
  z-index: 1;
  flex: 0 0 52px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding-right: 12px;
  background: ${({ theme }) => theme.color.surface.base};
  color: ${({ theme }) => theme.color.text.faint};
  border-right: 1px solid ${({ theme }) => theme.color.border.soft};
  font-family: ${({ theme }) => theme.font.mono};
  font-size: 11px;
  user-select: none;
`
// $modified: 아직 적용되지 않은 스테이징 값을 보여주는 셀. 서버 값과 구분되지 않으면
// 사용자는 무엇을 쓰려는지 검토할 수 없다(= 명시적 apply의 의미가 사라진다).
// box-shadow(레이아웃에 영향 없음)로 표시해 가상화 행 높이를 흔들지 않는다.
const Cell = styled.div<{ $modified: boolean; $editable: boolean }>`
  flex-shrink: 0;
  display: flex;
  align-items: center;
  padding: 0 ${({ theme }) => theme.space.md};
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  border-right: 1px solid ${({ theme }) => theme.color.border.soft};
  > span { overflow: hidden; text-overflow: ellipsis; }
  &[data-numeric='true'] { justify-content: flex-end; }
  &[aria-selected='true'] {
    background: ${({ theme }) => theme.color.row.selected};
    outline: 1px solid ${({ theme }) => theme.color.intent.accent};
    outline-offset: -1px;
  }
  background: ${({ theme, $modified }) => ($modified ? theme.color.row.staged : 'transparent')};
  box-shadow: ${({ theme, $modified }) => ($modified ? `inset 2px 0 0 ${theme.color.intent.accent}` : 'none')};
  cursor: ${({ $editable }) => ($editable ? 'text' : 'inherit')};

  &[data-editable]:hover {
    background: ${({ theme }) => theme.color.row.hover};
  }

  &[data-editable]:focus-visible {
    outline: 1px solid ${({ theme }) => theme.color.intent.accent};
    outline-offset: -1px;
  }
`
const CellInput = styled.input`
  width: 100%;
  box-sizing: border-box;
  font: inherit;
  background: ${({ theme }) => theme.color.surface.bg};
  color: inherit;
  height: 28px;
  padding: 0 6px;
  border-radius: ${({ theme }) => theme.radius.sm};
  border: 1px solid ${({ theme }) => theme.color.intent.accent};
`
const NullButton = styled.button`
  flex: 0 0 auto;
  margin-left: 2px;
  font: inherit;
  cursor: pointer;
  border: 1px solid ${({ theme }) => theme.color.border.strong};
  background: ${({ theme }) => theme.color.surface.base};
  color: ${({ theme }) => theme.color.text.dim};
`
const DeleteToggleCell = styled.div`
  flex: 0 0 28px;
  display: flex;
  align-items: center;
  justify-content: center;
`
/**
 * 가상화 행. 높이를 ROW_HEIGHT로 **고정**한다 — 이 값은 배치 간격이기도 하므로,
 * 내용이 정하게 두면 폰트나 패딩이 커질 때 행이 슬롯을 넘어 겹친다.
 * 셀은 세로 중앙 정렬하고 가로 패딩만 받는다.
 */
const Row = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  display: flex;
  height: ${ROW_HEIGHT}px;
  border-bottom: 1px solid ${({ theme }) => theme.color.row.line};
  &[data-alternate='true'] { background: ${({ theme }) => theme.color.grid.alternate}; }

  &:hover {
    background: ${({ theme }) => theme.color.row.hover};
  }
  &[data-deleted='true'] {
    background: ${({ theme }) => theme.color.intentSoft.danger};
    color: ${({ theme }) => theme.color.text.dim};
    text-decoration: line-through;
  }
  &[data-new-row] {
    position: relative;
    background: ${({ theme }) => theme.color.intentSoft.success};
  }
`

export interface EditingProps {
  onCommitCell: (rowIndex: number, column: string, text: string) => void
  /** 행 인덱스 → 컬럼명 → 스테이징 값. 서버 값 대신 이걸 그린다(저장 전 검토용). */
  edits: ReadonlyMap<number, ReadonlyMap<string, WireValue>>
  deletedRows: ReadonlySet<number>
  onToggleDelete: (rowIndex: number) => void
  newRows: readonly ReadonlyMap<string, WireValue>[]
  onCommitNewCell: (newRowIndex: number, column: string, text: string) => void
  onSetNull: (rowIndex: number, column: string) => void
  onSetNewCellNull: (newRowIndex: number, column: string) => void
}

interface Props {
  columns: readonly ColumnDescriptor[]
  rows: readonly (readonly WireValue[])[]
  hasMore?: boolean
  onLoadMore?: () => void
  sort?: BrowseSort
  onHeaderClick?: ((column: string) => void) | undefined
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
  const [selected, setSelected] = useState<GridPoint | null>(null)
  const anchor = useRef<GridPoint | null>(null)
  const [copyError, setCopyError] = useState<string | null>(null)
  const [widths, setWidths] = useState<Readonly<Record<string, number>>>({})
  const drag = useRef<{ key: string; x: number; width: number } | null>(null)
  const columnWidth = (index: number) => widths[`${index}:${columns[index]?.name ?? ''}`] ?? 190
  const scrollRef = useRef<HTMLDivElement>(null)
  const firstRow = rows[0]
  const columnKey = columns.map((column) => column.name).join('\u0000')
  useEffect(() => {
    anchor.current = null
    setSelected(null)
    setEditingCell(null)
    setCopyError(null)
  }, [firstRow, columnKey])
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
  const selectCell = (point: GridPoint, extend: boolean) => {
    if (!extend || anchor.current === null) anchor.current = point
    setSelected(point)
  }
  const inSelection = (row: number, col: number) => selected !== null && anchor.current !== null
    && row >= Math.min(selected.row, anchor.current.row) && row <= Math.max(selected.row, anchor.current.row)
    && col >= Math.min(selected.col, anchor.current.col) && col <= Math.max(selected.col, anchor.current.col)
  return (
    <Scroll ref={scrollRef} data-grid-scroll onScroll={onScroll} role="grid" aria-label="데이터 결과" aria-rowcount={rows.length + 1} aria-colcount={columns.length}
      onCopy={(event) => {
        if (selected === null || anchor.current === null || event.target instanceof HTMLInputElement) return
        try {
          event.clipboardData.setData('text/plain', selectionText(rows, anchor.current, selected, columns.map((column) => column.name), editing?.edits))
          event.preventDefault(); setCopyError(null)
        } catch (error) { event.preventDefault(); setCopyError(error instanceof Error ? error.message : '복사하지 못했습니다.') }
      }}>
      {copyError !== null && <div role="alert">{copyError}</div>}
      <Sheet>
      <HeaderRow role="row">
        <Gutter aria-hidden>#</Gutter>
        {editing !== undefined && <DeleteToggleCell aria-hidden />}
        {columns.map((c, i) => {
          const dir = sort?.column === c.name ? (sort.direction === 'desc' ? ' ▼' : ' ▲') : ''
          return (
            <HeaderCell
              key={i}
              role="columnheader"
              aria-sort={sort?.column === c.name ? sort.direction === 'asc' ? 'ascending' : 'descending' : 'none'}
              style={{ width: columnWidth(i), cursor: onHeaderClick ? 'pointer' : 'default' }}
              tabIndex={onHeaderClick ? 0 : undefined}
              onKeyDown={(event) => {
                if (onHeaderClick && (event.key === 'Enter' || event.key === ' ')) {
                  event.preventDefault(); onHeaderClick(c.name)
                }
              }}
              onClick={onHeaderClick ? () => onHeaderClick(c.name) : undefined}
            >
              <HeaderLabel title={c.name}>{c.name}{dir}</HeaderLabel>
              <TypeLabel title={c.type}>{c.type}</TypeLabel>
              <ResizeHandle role="separator" aria-label={`${c.name} 열 너비`} aria-orientation="vertical"
                aria-valuemin={100} aria-valuemax={640} aria-valuenow={columnWidth(i)} tabIndex={0}
                onClick={(e) => e.stopPropagation()}
                onDoubleClick={(e) => { e.stopPropagation(); setWidths((cur) => ({ ...cur, [`${i}:${c.name}`]: 190 })) }}
                onKeyDown={(e) => {
                  e.stopPropagation()
                  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
                  e.preventDefault()
                  setWidths((cur) => ({ ...cur, [`${i}:${c.name}`]: Math.min(640, Math.max(100, columnWidth(i) + (e.key === 'ArrowRight' ? 20 : -20))) }))
                }}
                onPointerDown={(e) => {
                  e.stopPropagation(); e.preventDefault()
                  drag.current = { key: `${i}:${c.name}`, x: e.clientX, width: columnWidth(i) }
                  e.currentTarget.setPointerCapture?.(e.pointerId)
                }}
                onPointerMove={(e) => {
                  const current = drag.current
                  if (current === null) return
                  const width = Math.min(640, Math.max(100, current.width + e.clientX - current.x))
                  setWidths((cur) => ({ ...cur, [current.key]: width }))
                }}
                onPointerUp={() => { drag.current = null }} onPointerCancel={() => { drag.current = null }}
              />
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
          // 행 단위로 한 번만 꺼낸다 — 셀마다 전체 edits를 훑으면 가상화 이득이 사라진다.
          const rowEdits = editing?.edits.get(rowIndex)
          return (
            <Row
              key={item.key}
              role="row"
              aria-rowindex={rowIndex + 2}
              data-alternate={rowIndex % 2 === 1}
              data-deleted={deleted}
              style={{ transform: `translateY(${item.start}px)` }}
            >
              <Gutter aria-hidden>{rowIndex + 1}</Gutter>
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
                // edits는 컬럼명 키인데 셀 순회는 인덱스다 — onCommitCell과 같은 방식으로 이름을 뽑는다.
                const columnName = columns[ci]?.name
                const staged = columnName === undefined ? undefined : rowEdits?.get(columnName)
                const shown = staged ?? value
                const isEditingThisCell =
                  editingCell !== null && editingCell.row === rowIndex && editingCell.col === ci
                if (editing !== undefined && isEditingThisCell) {
                  // 스테이징 값이 있으면 그게 초기값이다. 서버 값으로 되돌리면 사용자가
                  // 값을 확인하려고 셀을 다시 연 것만으로 자기 편집이 취소된다.
                  const initialText = rawCellText(shown)
                  const commit = (text: string) => {
                    if (columnName !== undefined) editing.onCommitCell(rowIndex, columnName, text)
                  }
                  return (
                    <Cell
                      key={ci}
                      data-cell
                      role="gridcell"
                      style={{ width: columnWidth(ci) }}
                      $modified={staged !== undefined}
                      $editable={false}
                    >
                      <CellInput
                        autoFocus
                        defaultValue={initialText}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            commit(e.currentTarget.value)
                            setEditingCell(null)
                          } else if (e.key === 'Escape') {
                            setEditingCell(null)
                          }
                        }}
                        // Tab이나 옆 셀 클릭은 취소 제스처가 아니다(취소는 Escape) — 입력을
                        // 버리지 않고 커밋한다. 단 값이 그대로면 커밋하지 않는다: editCell은
                        // 무조건 {t:'str'}로 스테이징하므로, 들여다보기만 한 셀까지
                        // `SET id = '7'` 같은 무의미한 UPDATE가 되어 저장 대상에 섞인다.
                        // NULL 버튼은 아래 preventDefault로 포커스를 뺏지 않아 여기로 오지 않는다.
                        onBlur={(e) => {
                          if (e.currentTarget.value !== initialText) commit(e.currentTarget.value)
                          setEditingCell(null)
                        }}
                      />
                      <NullButton
                        type="button"
                        aria-label={`행 ${rowIndex} ${columnName ?? ''} NULL`}
                        // 인풋 blur가 먼저 나 편집이 닫히면 클릭이 사라진다 — 막는다.
                        // (blur가 입력을 커밋하게 된 뒤로는 NULL 대신 입력 문자열이 들어가는 문제도 겸한다.)
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          if (columnName !== undefined) editing.onSetNull(rowIndex, columnName)
                          setEditingCell(null)
                        }}
                      >
                        ∅
                      </NullButton>
                    </Cell>
                  )
                }
                return (
                  <Cell
                    key={ci}
                    data-cell
                    role="gridcell"
                    aria-colindex={ci + 1}
                    aria-selected={inSelection(rowIndex, ci)}
                    aria-label={`${rowIndex + 1}행 ${columnName ?? ''}`}
                    data-row-index={rowIndex}
                    data-col-index={ci}
                    data-numeric={['int', 'float', 'bigint', 'decimal'].includes(shown.t)}
                    title={shown.t === 'null' ? 'NULL' : String(shown.v)}
                    style={{ width: columnWidth(ci) }}
                    onClick={(event) => { selectCell({ row: rowIndex, col: ci }, event.shiftKey); event.currentTarget.focus() }}
                    data-editable={editing !== undefined ? '' : undefined}
                    data-modified={staged !== undefined ? '' : undefined}
                    $modified={staged !== undefined}
                    $editable={editing !== undefined}
                    tabIndex={selected === null ? rowIndex === 0 && ci === 0 ? 0 : -1 : selected.row === rowIndex && selected.col === ci ? 0 : -1}
                    onDoubleClick={
                      editing !== undefined ? () => setEditingCell({ row: rowIndex, col: ci }) : undefined
                    }
                    onKeyDown={(e) => {
                            if (editing !== undefined && (e.key === 'Enter' || e.key === 'F2')) {
                              e.preventDefault()
                              setEditingCell({ row: rowIndex, col: ci })
                              return
                            }
                            if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return
                            e.preventDefault()
                            const row = Math.min(rows.length - 1, Math.max(0, rowIndex + (e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0)))
                            const col = e.key === 'Home' ? 0 : e.key === 'End' ? columns.length - 1 : Math.min(columns.length - 1, Math.max(0, ci + (e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0)))
                            if (anchor.current === null) anchor.current = { row: rowIndex, col: ci }
                            selectCell({ row, col }, e.shiftKey)
                            virtualizer.scrollToIndex(row, { align: 'auto' })
                            requestAnimationFrame(() => scrollRef.current?.querySelector<HTMLElement>(`[data-row-index="${row}"][data-col-index="${col}"]`)?.focus())
                          }}
                  >
                    {renderCell(shown)}
                  </Cell>
                )
              })}
            </Row>
          )
        })}
      </div>
      {editing !== undefined && editing.newRows.length > 0 && (
        <div data-new-rows>
          {editing.newRows.map((newRow, i) => (
            <Row key={`new-${i}`} data-new-row>
              <Gutter aria-hidden>+</Gutter>
              <DeleteToggleCell aria-hidden />
              {columns.map((c, ci) => {
                const staged = newRow.get(c.name)
                const isNull = staged?.t === 'null'
                const text = staged !== undefined && staged.t === 'str' ? staged.v : ''
                return (
                  <Cell
                    key={ci}
                    data-cell
                    style={{ width: columnWidth(ci) }}
                    $modified={false}
                    $editable={false}
                  >
                    <CellInput
                      aria-label={`새 행 ${i} ${c.name}`}
                      value={text}
                      placeholder={isNull ? 'NULL' : ''}
                      onChange={(e) => editing.onCommitNewCell(i, c.name, e.currentTarget.value)}
                    />
                    <NullButton
                      type="button"
                      aria-label={`새 행 ${i} ${c.name} NULL`}
                      onClick={() => editing.onSetNewCellNull(i, c.name)}
                    >
                      ∅
                    </NullButton>
                  </Cell>
                )
              })}
            </Row>
          ))}
        </div>
      )}
      </Sheet>
    </Scroll>
  )
}
