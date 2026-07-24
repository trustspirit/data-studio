import { describe, it, expect } from 'vitest'
import { operationRequestSchema } from '@shared/contracts/operationDto'

function parse(operation: unknown) {
  return operationRequestSchema.safeParse({ requestId: 'r', connectionId: 'c', operation })
}

describe('operationDto — stream', () => {
  it('listTopics를 파싱한다', () => {
    expect(parse({ kind: 'stream', op: 'listTopics' }).success).toBe(true)
  })
  it('subscribe는 topic + from이 필요하다', () => {
    expect(parse({ kind: 'stream', op: 'subscribe', topic: 't', from: 'latest' }).success).toBe(true)
    expect(parse({ kind: 'stream', op: 'subscribe', topic: 't' }).success).toBe(false)
    expect(parse({ kind: 'stream', op: 'subscribe', topic: 't', from: 'sideways' }).success).toBe(false)
  })
  it('unsubscribe는 subscriptionId가 필요하다', () => {
    expect(parse({ kind: 'stream', op: 'unsubscribe', subscriptionId: 's1' }).success).toBe(true)
    expect(parse({ kind: 'stream', op: 'unsubscribe' }).success).toBe(false)
  })
})
