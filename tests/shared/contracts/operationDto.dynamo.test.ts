import { describe, it, expect } from 'vitest'
import { operationRequestSchema } from '@shared/contracts/operationDto'

function parse(operation: unknown) {
  return operationRequestSchema.safeParse({ requestId: 'r', connectionId: 'c', operation })
}

describe('operationDto — dynamo', () => {
  it('listTables를 통과시킨다', () => {
    expect(parse({ kind: 'dynamo', op: 'listTables' }).success).toBe(true)
  })
  it('scan은 table이 필요하다', () => {
    expect(parse({ kind: 'dynamo', op: 'scan', table: 't' }).success).toBe(true)
    expect(parse({ kind: 'dynamo', op: 'scan' }).success).toBe(false)
    expect(parse({ kind: 'dynamo', op: 'scan', table: '' }).success).toBe(false)
  })
  it('partiql은 statement가 필요하다', () => {
    expect(parse({ kind: 'dynamo', op: 'partiql', statement: 'SELECT * FROM "t"' }).success).toBe(true)
    expect(parse({ kind: 'dynamo', op: 'partiql' }).success).toBe(false)
  })
  it('모르는 op을 거부한다', () => {
    expect(parse({ kind: 'dynamo', op: 'putItem', table: 't' }).success).toBe(false)
  })
})
