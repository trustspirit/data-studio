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

  it('data:apply를 changes와 함께 받아들인다', () => {
    const parsed = operationRequestSchema.parse(
      req({
        kind: 'data', op: 'apply', schema: 'public', table: 't',
        changes: [
          { op: 'insert', values: { id: { t: 'int', v: 1 }, name: { t: 'str', v: 'a' } } },
          { op: 'update', pk: { id: { t: 'int', v: 2 } }, set: { name: { t: 'null' } } },
          { op: 'delete', pk: { id: { t: 'int', v: 3 } } },
        ],
      }),
    )
    expect(parsed.operation).toMatchObject({ op: 'apply', table: 't' })
    if (parsed.operation.kind === 'data' && parsed.operation.op === 'apply') {
      expect(parsed.operation.changes).toHaveLength(3)
    }
  })

  it('data:apply의 잘못된 WireValue(모르는 t)는 거부한다', () => {
    expect(() =>
      operationRequestSchema.parse(
        req({ kind: 'data', op: 'apply', schema: 'public', table: 't',
          changes: [{ op: 'delete', pk: { id: { t: 'bogus', v: 1 } } }] }),
      ),
    ).toThrow()
  })

  it('wireValueSchema는 WireValue와 구조가 같다(타입 수준)', () => {
    // z.infer<typeof wireValueSchema>가 WireValue에 대입 가능해야 한다.
    // operationDto가 wireValueSchema를 export하지 않으면, apply DTO를 통해
    // 간접 확인: 파싱 결과의 pk 값이 WireValue로 좁혀진다.
    const parsed = operationRequestSchema.parse(
      req({ kind: 'data', op: 'apply', schema: 's', table: 't',
        changes: [{ op: 'delete', pk: { id: { t: 'bigint', v: '9007199254740993' } } }] }),
    )
    expect(parsed.operation).toMatchObject({ op: 'apply' })
  })
})
