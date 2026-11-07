import type { BrowseFilter } from '../../../../shared/types/operation'
import type { BuiltStatement } from './DataCapability'

export function buildBrowseFilters(filters: readonly BrowseFilter[], quote: (name: string) => string, dialect: 'postgres' | 'mysql' | 'sqlite'): BuiltStatement {
  const params: string[] = []
  const operators = { eq: '=', ne: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' } as const
  const clauses = filters.map((filter) => {
    const column = quote(filter.column)
    if (filter.operator === 'isNull') return `${column} IS NULL`
    if (filter.operator === 'isNotNull') return `${column} IS NOT NULL`
    if (!('value' in filter)) throw new Error('filter requires a value')
    const value = filter.value
    params.push(filter.operator === 'contains' ? `%${value.replace(/[!%_]/g, '!$&')}%` : value)
    const placeholder = dialect === 'postgres' ? `$${params.length}` : '?'
    if (filter.operator === 'contains') return `CAST(${column} AS ${dialect === 'mysql' ? 'CHAR' : 'TEXT'}) LIKE ${placeholder} ESCAPE '!'`
    return `${column} ${operators[filter.operator]} ${placeholder}`
  })
  return { sql: clauses.length === 0 ? '' : ` WHERE ${clauses.join(' AND ')}`, params }
}
