import { describe, it, expect } from 'vitest'
import { decide, type PolicyInput } from '@main/core/execution/ExecutionPolicy'
import type { Operation } from '@shared/types/operation'

function input(over: Partial<PolicyInput> & { operation: Operation }): PolicyInput {
  return {
    actor: { type: 'user', grant: null },
    hasSql: false, hasSchema: false, hasData: false, hasDocument: false, hasKeyValue: false, hasStream: false, hasDynamo: false,
    supportsReadOnlyScope: false,
    driverClassify: () => 'unknown',
    requestedLimits: undefined,
    ...over,
  }
}

const listOp: Operation = { kind: 'stream', op: 'listTopics' }
const subOp: Operation = { kind: 'stream', op: 'subscribe', topic: 't', from: 'latest' }

describe('decide — stream', () => {
  it('hasStream 없으면 capability_missing', () => {
    expect(decide(input({ operation: listOp }))).toEqual({ allow: false, reason: 'capability_missing' })
  })
  it('사용자 listTopics는 read로 허용(readOnlyScope false)', () => {
    const d = decide(input({ operation: listOp, hasStream: true }))
    expect(d.allow).toBe(true)
    if (d.allow) expect(d.readOnlyScope).toBe(false)
  })
  it('AI subscribe도 허용(stream은 read)', () => {
    const d = decide(input({ operation: subOp, hasStream: true, actor: { type: 'ai', sessionId: 's' } }))
    expect(d.allow).toBe(true)
  })
})
