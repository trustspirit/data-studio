import { describe, it, expect } from 'vitest'
import { operationRequestSchema } from '@shared/contracts/operationDto'

function parse(operation: unknown) {
  return operationRequestSchema.safeParse({ requestId: 'r', connectionId: 'c', operation })
}

describe('operationDto — keyvalue', () => {
  it('scan(match 선택)을 파싱한다', () => {
    expect(parse({ kind: 'keyvalue', op: 'scan', match: 'u:*' }).success).toBe(true)
    expect(parse({ kind: 'keyvalue', op: 'scan' }).success).toBe(true)
  })

  it('get은 key가 필수다', () => {
    expect(parse({ kind: 'keyvalue', op: 'get', key: 'k' }).success).toBe(true)
    expect(parse({ kind: 'keyvalue', op: 'get' }).success).toBe(false)
  })

  it('알 수 없는 op은 거부한다', () => {
    expect(parse({ kind: 'keyvalue', op: 'del', key: 'k' }).success).toBe(false)
  })
})
