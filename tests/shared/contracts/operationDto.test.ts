import { describe, expect, it } from 'vitest'
import { operationRequestSchema } from '@shared/contracts/operationDto'

function req(operation: unknown) {
  return { requestId: 'r1', connectionId: 'c1', operation }
}

describe('operationRequestSchema — schema ops', () => {
  it('listIndexes를 schema/table과 함께 받아들인다', () => {
    const parsed = operationRequestSchema.parse(
      req({ kind: 'schema', op: 'listIndexes', schema: 'public', table: 'users' }),
    )
    expect(parsed.operation).toEqual({
      kind: 'schema',
      op: 'listIndexes',
      schema: 'public',
      table: 'users',
    })
  })

  it('listForeignKeys를 schema/table과 함께 받아들인다', () => {
    const parsed = operationRequestSchema.parse(
      req({ kind: 'schema', op: 'listForeignKeys', schema: 'public', table: 'orders' }),
    )
    expect(parsed.operation).toMatchObject({ op: 'listForeignKeys', table: 'orders' })
  })

  it('listIndexes에서 table이 빠지면 거부한다', () => {
    // table 없이 통과하면 executor가 undefined를 드라이버에 넘긴다.
    expect(() =>
      operationRequestSchema.parse(req({ kind: 'schema', op: 'listIndexes', schema: 'public' })),
    ).toThrow()
  })

  it('기존 listSchemas도 그대로 받아들인다(회귀 방지)', () => {
    const parsed = operationRequestSchema.parse(req({ kind: 'schema', op: 'listSchemas' }))
    expect(parsed.operation).toEqual({ kind: 'schema', op: 'listSchemas' })
  })

  it('data:browse를 schema/table과 함께 받아들인다', () => {
    const parsed = operationRequestSchema.parse(
      req({ kind: 'data', op: 'browse', schema: 'public', table: 'users' }),
    )
    expect(parsed.operation).toEqual({ kind: 'data', op: 'browse', schema: 'public', table: 'users' })
  })

  it('data:browse의 sort를 받아들인다', () => {
    const parsed = operationRequestSchema.parse(
      req({ kind: 'data', op: 'browse', schema: 'public', table: 'users', sort: { column: 'id', direction: 'desc' } }),
    )
    expect(parsed.operation).toMatchObject({ sort: { column: 'id', direction: 'desc' } })
  })

  it('data:browse의 잘못된 정렬 방향은 거부한다', () => {
    expect(() =>
      operationRequestSchema.parse(
        req({ kind: 'data', op: 'browse', schema: 'public', table: 'users', sort: { column: 'id', direction: 'sideways' } }),
      ),
    ).toThrow()
  })
})
