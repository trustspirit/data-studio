import { describe, it, expect } from 'vitest'
import type { Capability } from '@shared/types/capability'
import { CAPABILITIES } from '@shared/types/capability'

describe('Capability', () => {
  it('현재 capability 3종을 노출한다', () => {
    const all: Capability[] = [...CAPABILITIES]
    expect([...all].sort()).toEqual(['data', 'schema', 'sql'])
  })
})
