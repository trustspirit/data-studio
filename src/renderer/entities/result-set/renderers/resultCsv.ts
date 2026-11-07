import type { ColumnDescriptor } from '../../../../shared/types/resultSet'
import type { WireValue } from '../../../../shared/types/wire'

function csvField(value: string, protectFormula = true): string {
  const safe = protectFormula && /^[\s]*[=+@-]/.test(value) ? `'${value}` : value
  return `"${safe.replace(/"/g, '""')}"`
}

/** Export only loaded rows; never execute another query to produce a download. */
export function resultCsv(
  columns: readonly ColumnDescriptor[],
  rows: readonly (readonly WireValue[])[],
): string {
  return '\ufeff' + [
    columns.map((column) => csvField(column.name)).join(','),
    ...rows.map((row) => columns.map((_, index) => {
      const cell = row[index]
      if (cell === undefined || cell.t === 'null') return ''
      const numeric = ['int', 'float', 'bigint', 'decimal'].includes(cell.t)
      return csvField(String(cell.v), !numeric)
    }).join(',')),
  ].join('\r\n') + '\r\n'
}

export function downloadResultCsv(columns: readonly ColumnDescriptor[], rows: readonly (readonly WireValue[])[]): void {
  const url = URL.createObjectURL(new Blob([resultCsv(columns, rows)], { type: 'text/csv;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `datacon-results-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
