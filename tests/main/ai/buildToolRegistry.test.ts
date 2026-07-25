import { describe, it, expect } from 'vitest'
import { buildToolRegistry } from '@main/ai/buildToolRegistry'

describe('buildToolRegistry', () => {
  it('7개 tool을 전부 등록한다', () => {
    const reg = buildToolRegistry()
    const names = reg.specs().map((s) => s.name).sort()
    expect(names).toEqual([
      'explain_analyze',
      'explain_query',
      'get_schema',
      'get_table_stats',
      'list_connections',
      'propose_write',
      'run_read_query',
    ])
  })
})
