import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LOG_CAPACITY,
  InMemoryOperationLog,
} from '@main/infrastructure/execution/InMemoryOperationLog'
import type { OperationLogEntry, OperationLogInput } from '@main/core/execution/OperationLog'

function createLog(capacity?: number) {
  let now = 0
  return new InMemoryOperationLog({ now: () => (now += 1) }, capacity)
}

type MutableLogInput = { -readonly [K in keyof OperationLogInput]: OperationLogInput[K] }

function entry(over: Partial<OperationLogInput> = {}): MutableLogInput {
  return {
    requestId: 'r1',
    connectionId: 'c1',
    actorType: 'user',
    actorId: null,
    statement: 'SELECT 1',
    outcome: 'allowed',
    durationMs: 1,
    ...over,
  }
}

describe('InMemoryOperationLog', () => {
  it('기록한 항목을 최신순으로 돌려준다', () => {
    const log = createLog()
    log.record(entry({ requestId: 'r1' }))
    log.record(entry({ requestId: 'r2' }))
    log.record(entry({ requestId: 'r3' }))

    expect(log.recent(10).map((e) => e.requestId)).toEqual(['r3', 'r2', 'r1'])
  })

  it('기록 시각을 붙인다', () => {
    const log = createLog()
    log.record(entry())

    expect(log.recent(1)[0]?.at).toBe(1)
  })

  it('거부된 요청도 기록한다', () => {
    // 거부 이력이 없으면 AI가 무엇을 시도했는지 알 수 없다.
    const log = createLog()
    log.record(
      entry({
        actorType: 'ai',
        actorId: 'sess-1',
        statement: 'DELETE FROM users',
        outcome: 'denied',
        denialReason: 'ai_write_requires_proposal',
      }),
    )

    expect(log.recent(10)[0]).toMatchObject({
      outcome: 'denied',
      denialReason: 'ai_write_requires_proposal',
      statement: 'DELETE FROM users',
    })
  })

  it('제안서 수명주기(제안·승인·거부·만료)를 기록한다', () => {
    // 스펙 §4.3: 승인·거부·만료를 전부 감사 로그에 남긴다.
    const log = createLog()
    for (const outcome of ['proposed', 'approved', 'rejected', 'expired'] as const) {
      log.record(entry({ requestId: outcome, outcome, actorType: 'ai', actorId: 'sess-1' }))
    }

    expect(log.recent(10).map((e) => e.outcome)).toEqual([
      'expired',
      'rejected',
      'approved',
      'proposed',
    ])
  })

  it('statementHash를 보존한다', () => {
    // 제안서와 실행 기록을 대조하려면 해시가 양쪽에 남아야 한다.
    const log = createLog()
    log.record(entry({ outcome: 'approved', statementHash: 'sha256:abc' }))

    expect(log.recent(1)[0]?.statementHash).toBe('sha256:abc')
  })

  it('AI 문장을 원문 그대로 보관한다', () => {
    // 스펙 §4.2 6층. 잘라내거나 정규화하면 감사 가치가 사라진다.
    const log = createLog()
    const statement = "SELECT * FROM t WHERE x = 'a;b' -- 주석"
    log.record(entry({ actorType: 'ai', actorId: 'sess-1', statement }))

    expect(log.recent(1)[0]?.statement).toBe(statement)
  })

  it('상한을 넘으면 오래된 것부터 버린다', () => {
    // 용량을 리터럴로 준다. 상한을 DEFAULT_LOG_CAPACITY에서 끌어오면 그 상수가
    // 무엇이든 통과해서, 검증 대상이 자기 자신이 된다.
    const log = createLog(2)
    for (const id of ['r1', 'r2', 'r3']) log.record(entry({ requestId: id }))

    expect(log.recent(10).map((e) => e.requestId)).toEqual(['r3', 'r2'])
  })

  it('기본 용량은 5000이다', () => {
    expect(DEFAULT_LOG_CAPACITY).toBe(5_000)
  })

  it('요청한 개수만 돌려준다', () => {
    const log = createLog()
    for (const id of ['r1', 'r2', 'r3']) log.record(entry({ requestId: id }))

    expect(log.recent(2).map((e) => e.requestId)).toEqual(['r3', 'r2'])
  })

  it('limit이 0이면 빈 목록을 준다', () => {
    // slice(-0)은 배열 전체를 준다. 경계를 다루지 않으면 0을 요청한 호출자가
    // 전체 로그를 받는다.
    const log = createLog()
    log.record(entry())

    expect(log.recent(0)).toEqual([])
  })

  it('음수 limit도 빈 목록을 준다', () => {
    const log = createLog()
    log.record(entry())

    expect(log.recent(-5)).toEqual([])
  })

  it('가진 것보다 많이 요청해도 가진 만큼만 준다', () => {
    const log = createLog()
    log.record(entry())

    expect(log.recent(100)).toHaveLength(1)
  })

  it('항목은 structuredClone 가능하다', () => {
    const log = createLog()
    log.record(entry({ actorType: 'ai', actorId: 'sess-1' }))

    const entries = log.recent(1)

    expect(() => structuredClone(entries)).not.toThrow()
    expect(structuredClone(entries)).toEqual(entries)
  })

  it('반환된 배열을 바꿔도 내부 상태가 오염되지 않는다', () => {
    const log = createLog()
    log.record(entry({ requestId: 'r1' }))
    log.record(entry({ requestId: 'r2' }))

    // readonly 타입을 벗겨야 실제로 바꿔 볼 수 있다. 타입이 막아 주는 것과
    // 런타임에 공유되지 않는 것은 다른 이야기다.
    const first = log.recent(10) as OperationLogEntry[]
    first.pop()
    first.push({ ...entry({ requestId: 'injected' }), at: 99 })

    expect(log.recent(10).map((e) => e.requestId)).toEqual(['r2', 'r1'])
  })

  it('기록 후 호출자가 입력 객체를 바꿔도 보관본이 바뀌지 않는다', () => {
    // 입력을 그대로 담으면, 호출자가 재사용하는 객체 하나로 이미 기록된
    // 감사 항목이 소급해서 바뀐다.
    const log = createLog()
    const input = entry({ requestId: 'r1', statement: 'SELECT 1' })
    log.record(input)

    input.statement = 'DROP TABLE users'
    input.requestId = 'r-forged'

    expect(log.recent(1)[0]).toMatchObject({ requestId: 'r1', statement: 'SELECT 1' })
  })

  it('반환된 항목을 바꿔도 보관본이 오염되지 않는다', () => {
    // 배열만 복사하고 항목을 공유하면, 조회한 쪽이 감사 기록의 내용을 고칠 수
    // 있다 — 감사 로그에서는 그게 정확히 막아야 할 일이다.
    const log = createLog()
    log.record(entry({ requestId: 'r1', statement: 'SELECT 1' }))

    const mutable = log.recent(1)[0] as { statement: string }
    mutable.statement = 'DROP TABLE users'

    expect(log.recent(1)[0]?.statement).toBe('SELECT 1')
  })
})
