import { describe, expect, it } from 'vitest'
import { buildBrowseFilters } from '@main/core/driver/capabilities/browseFilters'

const quote = (name: string) => `"${name.replace(/"/g, '""')}"`
describe('parameterized table filtering', () => {
  it('binds hostile values and quotes hostile column names', () => {
    const value = "' OR 1=1; DROP TABLE users; --"
    const result = buildBrowseFilters([{ column: 'odd"name', operator: 'eq', value }], quote, 'postgres')
    expect(result).toEqual({ sql: ' WHERE "odd""name" = $1', params: [value] })
    expect(result.sql).not.toContain('DROP TABLE')
  })
  it('escapes literal LIKE metacharacters and handles NULL without a parameter', () => {
    const result = buildBrowseFilters([
      { column: 'email', operator: 'contains', value: 'a_%!' },
      { column: 'deleted_at', operator: 'isNull' },
      { column: 'amount', operator: 'gte', value: '9007199254740993' },
    ], quote, 'postgres')
    expect(result.sql).toBe(' WHERE CAST("email" AS TEXT) LIKE $1 ESCAPE \'!\' AND "deleted_at" IS NULL AND "amount" >= $2')
    expect(result.params).toEqual(['%a!_!%!!%', '9007199254740993'])
  })
  it('uses the correct MySQL cast and positional placeholders', () => {
    expect(buildBrowseFilters([{ column: 'name', operator: 'contains', value: 'one' }], quote, 'mysql').sql).toContain('AS CHAR) LIKE ?')
  })
})
