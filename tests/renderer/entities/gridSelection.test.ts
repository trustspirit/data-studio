import { describe, expect, it } from 'vitest'
import { selectionText } from '@renderer/entities/result-set/model/gridSelection'
import { wire } from '@shared/types/wire'

describe('grid range copy', () => {
  it('copies a rectangular range in either selection direction and preserves precision', () => {
    const rows = [[wire.bigint('9007199254740993'), wire.str('a\tb')], [wire.null(), wire.str('two\nlines')]]
    expect(selectionText(rows, { row: 1, col: 1 }, { row: 0, col: 0 }, ['id', 'name'])).toBe('9007199254740993\t"a\tb"\nNULL\t"two\nlines"')
  })
  it('copies staged values rather than stale server data', () => {
    expect(selectionText([[wire.str('before')]], { row: 0, col: 0 }, { row: 0, col: 0 }, ['name'], new Map([[0, new Map([['name', wire.str('after')]])]]))).toBe('after')
  })
})
