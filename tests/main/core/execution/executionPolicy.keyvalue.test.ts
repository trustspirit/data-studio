import { describe, it, expect } from 'vitest'
import { decide, type PolicyInput } from '@main/core/execution/ExecutionPolicy'
import type { Operation } from '@shared/types/operation'

function input(over: Partial<PolicyInput> & { operation: Operation }): PolicyInput {
  return {
    actor: { type: 'user', grant: null },
    hasSql: false,
    hasSchema: false,
    hasData: false,
    hasDocument: false,
    hasKeyValue: false,
    supportsReadOnlyScope: false,
    driverClassify: () => 'unknown',
    requestedLimits: undefined,
    ...over,
  }
}

const scanOp: Operation = { kind: 'keyvalue', op: 'scan' }
const getOp: Operation = { kind: 'keyvalue', op: 'get', key: 'k' }

describe('decide — keyvalue', () => {
  it('hasKeyValue 없으면 capability_missing', () => {
    const d = decide(input({ operation: scanOp }))
    expect(d).toEqual({ allow: false, reason: 'capability_missing' })
  })

  it('사용자 scan은 read로 허용(readOnlyScope false)', () => {
    const d = decide(input({ operation: scanOp, hasKeyValue: true }))
    expect(d.allow).toBe(true)
    if (d.allow) expect(d.readOnlyScope).toBe(false)
  })

  it('AI get도 허용된다(scan/get은 read라 스코프 불필요)', () => {
    const d = decide(input({ operation: getOp, hasKeyValue: true, actor: { type: 'ai', sessionId: 's1' } }))
    expect(d.allow).toBe(true)
  })
})
