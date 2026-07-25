import { describe, it, expect } from 'vitest'
import { formatSchema, type SchemaContextInput } from '@main/ai/context/SchemaContextBuilder'

const input: SchemaContextInput = {
  connections: [
    { id: 'c2', name: 'beta', engine: 'mysql', tables: [{ schema: 's', name: 'z', columns: [{ name: 'b', type: 'int' }, { name: 'a', type: 'text' }] }] },
    { id: 'c1', name: 'alpha', engine: 'postgres', tables: [{ schema: 'public', name: 'users', columns: [{ name: 'id', type: 'int' }] }] },
  ],
}

describe('formatSchema', () => {
  it('결정적이다 — 같은 입력이면 항상 같은 문자열', () => {
    expect(formatSchema(input)).toBe(formatSchema(input))
  })
  it('커넥션과 테이블을 결정적으로 정렬한다(입력 순서 무관)', () => {
    const s = formatSchema(input)
    // alpha(c1)가 beta(c2)보다 먼저, 컬럼 a가 b보다 먼저.
    expect(s.indexOf('alpha')).toBeLessThan(s.indexOf('beta'))
    expect(s.indexOf('a text')).toBeLessThan(s.indexOf('b int'))
  })
  it('타임스탬프/UUID 등 가변 토큰을 넣지 않는다', () => {
    const s = formatSchema(input)
    expect(s).not.toMatch(/\d{13}/) // epoch ms
    expect(s).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/) // uuid
  })
})
