import type { WireValue } from '../../../../shared/types/wire'

export interface GridPoint { readonly row: number; readonly col: number }
export function selectionText(rows: readonly (readonly WireValue[])[], start: GridPoint, end: GridPoint, columns: readonly string[], edits?: ReadonlyMap<number, ReadonlyMap<string, WireValue>>): string {
  const lines: string[] = []
  let bytes = 0
  for (let row = Math.min(start.row, end.row); row <= Math.max(start.row, end.row); row++) {
    const cells: string[] = []
    for (let col = Math.min(start.col, end.col); col <= Math.max(start.col, end.col); col++) {
      const value = edits?.get(row)?.get(columns[col] ?? '') ?? rows[row]?.[col]
      const text = value === undefined || value.t === 'null' ? 'NULL' : String(value.v)
      bytes += text.length
      if (bytes > 2 * 1024 * 1024) throw new Error('선택한 데이터가 너무 큽니다. 범위를 줄이거나 CSV로 내보내세요.')
      cells.push(/[\t\r\n"]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text)
    }
    lines.push(cells.join('\t'))
  }
  return lines.join('\n')
}
