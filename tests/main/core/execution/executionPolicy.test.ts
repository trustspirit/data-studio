import { describe, expect, it } from 'vitest'
import { decide } from '@main/core/execution/ExecutionPolicy'
import type { PolicyInput } from '@main/core/execution/ExecutionPolicy'
import type { Actor } from '@main/core/execution/Actor'
import type { Operation } from '@shared/types/operation'
import { DEFAULT_AI_LIMITS, DEFAULT_USER_LIMITS } from '@shared/types/operation'

const USER: Actor = { type: 'user', grant: null }
const AI: Actor = { type: 'ai', sessionId: 'sess-1' }

const READ: Operation = { kind: 'sql', sql: 'SELECT 1' }
const WRITE: Operation = { kind: 'sql', sql: 'DELETE FROM users' }

function input(actor: Actor, operation: Operation, over: Partial<Parameters<typeof decide>[0]> = {}) {
  return {
    actor,
    operation,
    hasSql: true,
    hasSchema: true,
    hasData: true,
    supportsReadOnlyScope: true,
    driverClassify: (): 'read' | 'write' | 'unknown' => 'read',
    requestedLimits: undefined,
    ...over,
  }
}

describe('decide — 사용자', () => {
  it('읽기를 허용한다', () => {
    const decision = decide(input(USER, READ))

    expect(decision).toMatchObject({ allow: true, limits: DEFAULT_USER_LIMITS })
  })

  it('쓰기를 승인 없이 허용한다', () => {
    // 사용자가 직접 친 쿼리는 그 자체가 의도 표명이다. 승인 게이트는 AI용이다.
    expect(decide(input(USER, WRITE, { driverClassify: () => 'write' })).allow).toBe(true)
  })

  it('읽기 전용 스코프를 요구하지 않는다', () => {
    const decision = decide(input(USER, READ))

    expect(decision).toMatchObject({ allow: true, readOnlyScope: false })
  })
})

describe('decide — AI', () => {
  it('읽기를 허용하되 AI 제한과 읽기 전용 스코프를 건다', () => {
    const decision = decide(input(AI, READ))

    expect(decision).toMatchObject({
      allow: true,
      limits: DEFAULT_AI_LIMITS,
      readOnlyScope: true,
    })
  })

  it('승인 없는 쓰기를 거부한다', () => {
    const decision = decide(input(AI, WRITE, { driverClassify: () => 'write' }))

    expect(decision).toEqual({ allow: false, reason: 'ai_write_requires_proposal' })
  })

  it('다중 문장을 거부한다', () => {
    // 스펙 §4.2 4층.
    const multi: Operation = { kind: 'sql', sql: 'SELECT 1; SELECT 2' }

    expect(decide(input(AI, multi))).toEqual({ allow: false, reason: 'ai_multi_statement' })
  })

  it('공통 분류가 read여도 드라이버가 write면 거부한다', () => {
    // 두 층 중 하나라도 read가 아니면 쓰기다.
    const decision = decide(input(AI, READ, { driverClassify: () => 'write' }))

    expect(decision).toEqual({ allow: false, reason: 'ai_write_requires_proposal' })
  })

  it('드라이버가 unknown이면 거부한다 (fail-safe)', () => {
    const decision = decide(input(AI, READ, { driverClassify: () => 'unknown' }))

    expect(decision).toEqual({ allow: false, reason: 'ai_write_requires_proposal' })
  })

  it('읽기 전용 스코프를 지원하지 않는 엔진에서는 AI 읽기를 비활성화한다', () => {
    // 스펙 §4.2 2층: "엔진이 이를 지원하지 않으면 AI 읽기 기능을 비활성화한다".
    const decision = decide(input(AI, READ, { supportsReadOnlyScope: false }))

    expect(decision).toEqual({ allow: false, reason: 'ai_read_only_unsupported' })
  })

  it('EXPLAIN ANALYZE는 승인 대상이다', () => {
    const analyze: Operation = { kind: 'sql', sql: 'EXPLAIN ANALYZE SELECT 1' }

    expect(decide(input(AI, analyze)).allow).toBe(false)
  })

  it('일반 EXPLAIN은 자율 실행을 허용한다', () => {
    const explain: Operation = { kind: 'sql', sql: 'EXPLAIN SELECT 1' }

    expect(decide(input(AI, explain)).allow).toBe(true)
  })

  it('스키마 조회는 읽기 전용 스코프 없이도 허용한다', () => {
    // 메타데이터 조회는 데이터를 바꾸지 않으며, 읽기 전용 트랜잭션을
    // 지원하지 않는 엔진에서도 안전하다.
    const schema: Operation = { kind: 'schema', op: 'listSchemas' }
    const decision = decide(input(AI, schema, { supportsReadOnlyScope: false }))

    // readOnlyScope와 limits까지 단언한다. allow만 보면 이 분기가 어떤 스코프나
    // 어떤 제한을 주든 통과한다 — 실제로 AI에게 사용자 제한(30초 timeout)을
    // 주는 회귀가 전 스위트를 초록으로 통과했다.
    expect(decision).toMatchObject({
      allow: true,
      readOnlyScope: false,
      limits: DEFAULT_AI_LIMITS,
    })
  })

  it('AI 요청도 제한을 더 엄격하게만 만들 수 있다', () => {
    const decision = decide(
      input(AI, READ, { requestedLimits: { maxRows: DEFAULT_AI_LIMITS.maxRows * 10 } }),
    )

    expect(decision).toMatchObject({ allow: true, limits: DEFAULT_AI_LIMITS })
  })
})

describe('decide — capability', () => {
  it('sql 능력이 없으면 sql 요청을 거부한다', () => {
    expect(decide(input(USER, READ, { hasSql: false }))).toEqual({
      allow: false,
      reason: 'capability_missing',
    })
  })

  it('schema 능력이 없으면 schema 요청을 거부한다', () => {
    const schema: Operation = { kind: 'schema', op: 'listSchemas' }

    expect(decide(input(USER, schema, { hasSchema: false }))).toEqual({
      allow: false,
      reason: 'capability_missing',
    })
  })
})

describe('decide — 모르는 operation 종류', () => {
  // `Operation`은 document/keyvalue/stream이 붙을 예정인 판별 유니온이다.
  // 이 검사가 없으면 새 변형이 sql 경로로 흘러들어가, 어떤 capability 검사도
  // 그 변형을 보지 않은 채 사용자 경로에서 허용되어 버린다.
  const FUTURE = { kind: 'document', collection: 'users' } as unknown as Operation

  it('사용자 경로에서도 거부한다 (fail-open 금지)', () => {
    expect(decide(input(USER, FUTURE))).toEqual({
      allow: false,
      reason: 'capability_missing',
    })
  })

  it('AI 경로에서 던지지 않고 거부한다', () => {
    expect(decide(input(AI, FUTURE))).toEqual({
      allow: false,
      reason: 'capability_missing',
    })
  })
})

describe('decide — data:browse', () => {
  const BROWSE: Operation = { kind: 'data', op: 'browse', schema: 'public', table: 'users' }

  it('사용자 browse는 직접 허용(읽기 전용 스코프 없음)', () => {
    const d = decide(input(USER, BROWSE))
    expect(d).toMatchObject({ allow: true, readOnlyScope: false })
  })

  it('AI browse는 읽기 전용 스코프 안에서만 허용', () => {
    const d = decide(input(AI, BROWSE))
    expect(d).toMatchObject({ allow: true, readOnlyScope: true })
  })

  it('AI인데 RO 스코프 미지원이면 거부', () => {
    const d = decide(input(AI, BROWSE, { supportsReadOnlyScope: false }))
    expect(d).toEqual({ allow: false, reason: 'ai_read_only_unsupported' })
  })

  it('data 능력이 없으면 capability_missing', () => {
    expect(decide(input(USER, BROWSE, { hasData: false }))).toEqual({
      allow: false,
      reason: 'capability_missing',
    })
  })

  it('실행할 sql 능력이 없으면 capability_missing', () => {
    // browse는 조립만 data가 하고 실행은 sql 경로를 쓴다.
    expect(decide(input(USER, BROWSE, { hasSql: false }))).toEqual({
      allow: false,
      reason: 'capability_missing',
    })
  })
})

describe('decide — data:apply (write)', () => {
  const applyOp = {
    kind: 'data' as const, op: 'apply' as const, schema: 'public', table: 't',
    changes: [{ op: 'delete' as const, pk: { id: { t: 'int' as const, v: 1 } } }],
  }
  function inp(over: Partial<PolicyInput>): PolicyInput {
    return {
      actor: { type: 'user', grant: null }, operation: applyOp,
      hasSql: true, hasSchema: true, hasData: true,
      supportsReadOnlyScope: true, driverClassify: () => 'read', requestedLimits: undefined,
      ...over,
    }
  }
  it('사용자 apply는 직접 허용(쓰기, readOnlyScope 없음)', () => {
    expect(decide(inp({ actor: { type: 'user', grant: null } }))).toMatchObject({ allow: true, readOnlyScope: false })
  })
  it('AI apply는 제안서 없이는 거부한다', () => {
    expect(decide(inp({ actor: { type: 'ai', sessionId: 's' } }))).toEqual({ allow: false, reason: 'ai_write_requires_proposal' })
  })
  it('data 능력이 없으면 capability_missing', () => {
    expect(decide(inp({ hasData: false }))).toEqual({ allow: false, reason: 'capability_missing' })
  })
})
