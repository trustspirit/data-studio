import { describe, it, expect } from 'vitest'
import { decide, type PolicyInput } from '@main/core/execution/ExecutionPolicy'
import type { Operation } from '@shared/types/operation'
import type { Actor } from '@main/core/execution/Actor'

function input(over: Partial<PolicyInput> & { operation: Operation; actor: Actor }): PolicyInput {
  return {
    hasSql: false, hasSchema: false, hasData: false, hasDocument: false,
    hasKeyValue: false, hasStream: false, hasDynamo: true,
    supportsReadOnlyScope: false,
    driverClassify: () => 'unknown',
    requestedLimits: undefined,
    ...over,
  }
}
const user: Actor = { type: 'user', grant: null }
const ai: Actor = { type: 'ai', sessionId: 's1' }

describe('decide — dynamo', () => {
  it('사용자 scan을 허용한다', () => {
    const d = decide(input({ actor: user, operation: { kind: 'dynamo', op: 'scan', table: 't' } }))
    expect(d.allow).toBe(true)
  })
  it('listTables를 허용한다', () => {
    expect(decide(input({ actor: user, operation: { kind: 'dynamo', op: 'listTables' } })).allow).toBe(true)
  })
  it('partiql을 read로 허용한다(비-SELECT 거부는 executor/driver 몫)', () => {
    const d = decide(input({ actor: user, operation: { kind: 'dynamo', op: 'partiql', statement: 'SELECT * FROM "t"' } }))
    expect(d.allow).toBe(true)
  })
  it('AI도 read로 허용한다(readOnlyScope 불필요)', () => {
    const d = decide(input({ actor: ai, operation: { kind: 'dynamo', op: 'scan', table: 't' } }))
    expect(d).toMatchObject({ allow: true, readOnlyScope: false })
  })
  it('capability 없으면 거부한다', () => {
    const d = decide(input({ actor: user, hasDynamo: false, operation: { kind: 'dynamo', op: 'listTables' } }))
    expect(d).toEqual({ allow: false, reason: 'capability_missing' })
  })
})
