import { describe, expect, it } from 'vitest'
import { PROPOSAL_TTL_MS, WriteProposalStore } from '@main/core/execution/WriteProposalStore'

function createStore(startAt = 1_000) {
  let now = startAt
  let seq = 0

  const store = new WriteProposalStore({
    now: () => now,
    randomId: () => `prop-${(seq += 1)}`,
    hash: (text) => `hash(${text})`,
  })

  return { store, advance: (ms: number) => (now += ms) }
}

const IMPACT = { summary: '', estimatedRows: null }

function proposeDelete(store: WriteProposalStore, connectionId = 'conn-1') {
  return store.propose({ connectionId, statement: 'DELETE FROM users', impact: IMPACT })
}

describe('WriteProposalStore', () => {
  it('TTL은 5분이다', () => {
    // 리터럴로 못박는다. 모든 만료 테스트가 PROPOSAL_TTL_MS만큼 전진시키면
    // 그 상수가 5시간이어도 전부 통과한다 — 검증 대상이 자기 자신이 된다.
    expect(PROPOSAL_TTL_MS).toBe(5 * 60 * 1000)
  })

  it('만료 시각은 생성 시각 + 5분이다', () => {
    const { store } = createStore(1_000)

    expect(proposeDelete(store).expiresAt).toBe(1_000 + 300_000)
  })

  it('5분이 지나면 리터럴 기준으로도 만료된다', () => {
    const { store, advance } = createStore()
    const view = proposeDelete(store)

    advance(300_000)

    expect(store.consume(view.proposalId, 'conn-1')).toEqual({ ok: false, reason: 'expired' })
  })

  it('제안서를 저장하고 표시용 정보를 돌려준다', () => {
    const { store } = createStore()

    const view = store.propose({
      connectionId: 'conn-1',
      statement: 'DELETE FROM users',
      impact: { summary: '1 table', estimatedRows: 10 },
    })

    expect(view).toMatchObject({
      proposalId: 'prop-1',
      connectionId: 'conn-1',
      statement: 'DELETE FROM users',
      impact: { summary: '1 table', estimatedRows: 10 },
    })
  })

  it('소비하면 보관된 원문을 돌려준다', () => {
    const { store } = createStore()
    const view = proposeDelete(store)

    expect(store.consume(view.proposalId, 'conn-1')).toMatchObject({
      ok: true,
      statement: 'DELETE FROM users',
    })
  })

  it('같은 제안서를 두 번 소비할 수 없다', () => {
    const { store } = createStore()
    const view = proposeDelete(store)

    store.consume(view.proposalId, 'conn-1')

    expect(store.consume(view.proposalId, 'conn-1')).toEqual({ ok: false, reason: 'consumed' })
  })

  it('만료된 제안서를 거부한다', () => {
    const { store, advance } = createStore()
    const view = proposeDelete(store)

    advance(PROPOSAL_TTL_MS)

    expect(store.consume(view.proposalId, 'conn-1')).toEqual({ ok: false, reason: 'expired' })
  })

  it('만료 직전까지는 유효하다', () => {
    const { store, advance } = createStore()
    const view = proposeDelete(store)

    advance(PROPOSAL_TTL_MS - 1)

    expect(store.consume(view.proposalId, 'conn-1')).toMatchObject({ ok: true })
  })

  it('다른 커넥션으로는 소비할 수 없다', () => {
    // 커넥션 A용으로 승인받은 문장이 커넥션 B(운영 DB)에서 실행되면 안 된다.
    const { store } = createStore()
    const view = proposeDelete(store)

    expect(store.consume(view.proposalId, 'conn-2')).toEqual({
      ok: false,
      reason: 'connection_mismatch',
    })
  })

  it('연결 불일치로 실패해도 제안서를 소비하지 않는다', () => {
    // 잘못 겨눈 시도 하나가 사용자의 정상 승인을 태워 없애면 안 된다.
    const { store } = createStore()
    const view = proposeDelete(store)

    store.consume(view.proposalId, 'conn-2')

    expect(store.consume(view.proposalId, 'conn-1')).toMatchObject({ ok: true })
  })

  it('모르는 id를 거부한다', () => {
    const { store } = createStore()

    expect(store.consume('nope', 'conn-1')).toEqual({ ok: false, reason: 'not_found' })
  })

  it('거부하면 이후 소비할 수 없다', () => {
    const { store } = createStore()
    const view = proposeDelete(store)

    store.reject(view.proposalId, 'conn-1')

    expect(store.consume(view.proposalId, 'conn-1')).toEqual({ ok: false, reason: 'not_found' })
  })

  it('statementHash를 기록한다', () => {
    const { store } = createStore()

    expect(proposeDelete(store).statementHash).toBe('hash(DELETE FROM users)')
  })

  it('소비 결과에도 statementHash를 싣는다', () => {
    const { store } = createStore()
    const view = proposeDelete(store)

    expect(store.consume(view.proposalId, 'conn-1')).toMatchObject({
      ok: true,
      statementHash: 'hash(DELETE FROM users)',
    })
  })

  it('제안서마다 다른 id를 쓴다', () => {
    const { store } = createStore()

    expect(proposeDelete(store).proposalId).not.toBe(proposeDelete(store).proposalId)
  })

  it('sweep은 만료된 것만 지운다', () => {
    const { store, advance } = createStore()
    const stale = store.propose({ connectionId: 'conn-1', statement: 'A', impact: IMPACT })
    advance(PROPOSAL_TTL_MS)
    const fresh = store.propose({ connectionId: 'conn-1', statement: 'B', impact: IMPACT })

    store.sweep()

    expect(store.consume(stale.proposalId, 'conn-1')).toEqual({ ok: false, reason: 'not_found' })
    expect(store.consume(fresh.proposalId, 'conn-1')).toMatchObject({ ok: true })
  })

  it('pending은 요청한 id의 제안서를 준다', () => {
    // 제안서를 둘 이상 담아야 조회가 실제로 일어나는지 알 수 있다. 하나만 두면
    // 인자를 무시하고 아무거나 돌려주는 구현도 통과한다.
    const { store } = createStore()
    const a = store.propose({ connectionId: 'conn-1', statement: 'DELETE FROM a', impact: IMPACT })
    const b = store.propose({ connectionId: 'conn-1', statement: 'DELETE FROM b', impact: IMPACT })

    expect(store.pending(a.proposalId)?.statement).toBe('DELETE FROM a')
    expect(store.pending(b.proposalId)?.statement).toBe('DELETE FROM b')
  })

  it('pending은 소비된 제안서를 주지 않는다', () => {
    const { store } = createStore()
    const view = proposeDelete(store)

    store.consume(view.proposalId, 'conn-1')

    expect(store.pending(view.proposalId)).toBeNull()
  })

  it('pending은 만료된 제안서를 주지 않는다', () => {
    const { store, advance } = createStore()
    const view = proposeDelete(store)

    advance(PROPOSAL_TTL_MS)

    expect(store.pending(view.proposalId)).toBeNull()
  })

  it('id가 충돌하면 조용히 덮어쓰지 않고 던진다', () => {
    const store = new WriteProposalStore({
      now: () => 1_000,
      randomId: () => 'same-id',
      hash: (t) => t,
    })
    store.propose({ connectionId: 'conn-1', statement: 'A', impact: IMPACT })

    expect(() =>
      store.propose({ connectionId: 'conn-1', statement: 'B', impact: IMPACT }),
    ).toThrow(/collision/)
    // 원래 제안서가 살아 있어야 한다.
    expect(store.pending('same-id')?.statement).toBe('A')
  })

  it('다른 커넥션으로는 거부(reject)할 수 없다', () => {
    const { store } = createStore()
    const view = proposeDelete(store)

    expect(store.reject(view.proposalId, 'conn-2')).toBe(false)
    expect(store.pending(view.proposalId)).not.toBeNull()
  })

  it('reject는 실제로 지웠는지 알려준다', () => {
    const { store } = createStore()
    const view = proposeDelete(store)

    expect(store.reject(view.proposalId, 'conn-1')).toBe(true)
    expect(store.reject('nope', 'conn-1')).toBe(false)
  })

  it('sweep은 소비된 제안서도 지운다', () => {
    // 소비된 제안서를 TTL까지 들고 있으면 문장 원문이 필요 이상으로 오래 남는다.
    const { store } = createStore()
    const view = proposeDelete(store)
    store.consume(view.proposalId, 'conn-1')

    store.sweep()

    expect(store.consume(view.proposalId, 'conn-1')).toEqual({ ok: false, reason: 'not_found' })
  })

  it('제안서 뷰는 structuredClone 가능하다', () => {
    const { store } = createStore()
    const view = proposeDelete(store)

    expect(() => structuredClone(view)).not.toThrow()
    expect(structuredClone(view)).toEqual(view)
  })

  it('뷰를 바꿔도 보관된 원문은 오염되지 않는다', () => {
    // renderer로 나간 표현이 main의 보관본과 같은 객체를 가리키면, 표시용
    // 값을 만지는 코드 하나가 실제로 실행될 문장을 바꿔 버린다.
    const { store } = createStore()
    const view = proposeDelete(store)

    const mutable = view as { statement: string }
    mutable.statement = 'DROP TABLE users'

    expect(store.consume(view.proposalId, 'conn-1')).toMatchObject({
      ok: true,
      statement: 'DELETE FROM users',
    })
  })

  it('뷰의 impact를 바꿔도 보관본이 오염되지 않는다', () => {
    // 문자열은 불변이라 statement 변형만으로는 객체 공유를 잡지 못한다.
    // 승인 UI가 표시할 영향도를 renderer 쪽에서 만졌을 때 main의 기록이
    // 함께 바뀌면, 감사 로그와 실제 승인 내용이 어긋난다.
    const { store } = createStore()
    const view = store.propose({
      connectionId: 'conn-1',
      statement: 'DELETE FROM users',
      impact: { summary: '10 rows', estimatedRows: 10 },
    })

    const mutable = view.impact as { summary: string; estimatedRows: number | null }
    mutable.summary = '0 rows'
    mutable.estimatedRows = 0

    expect(store.pending(view.proposalId)?.impact).toEqual({
      summary: '10 rows',
      estimatedRows: 10,
    })
  })

  it('pending이 돌려준 impact를 바꿔도 보관본이 오염되지 않는다', () => {
    // propose의 뷰와 pending의 뷰는 각각 따로 복사해야 한다. 한쪽만 복사하면
    // 다른 쪽이 보관본으로 가는 통로로 남는다.
    const { store } = createStore()
    const view = store.propose({
      connectionId: 'conn-1',
      statement: 'DELETE FROM users',
      impact: { summary: '10 rows', estimatedRows: 10 },
    })

    const first = store.pending(view.proposalId)
    const mutable = first?.impact as { summary: string; estimatedRows: number | null }
    mutable.summary = '0 rows'
    mutable.estimatedRows = 0

    expect(store.pending(view.proposalId)?.impact).toEqual({
      summary: '10 rows',
      estimatedRows: 10,
    })
  })

  it('호출자가 넘긴 impact를 나중에 바꿔도 보관본이 바뀌지 않는다', () => {
    const { store } = createStore()
    const impact = { summary: '10 rows', estimatedRows: 10 }
    const view = store.propose({ connectionId: 'conn-1', statement: 'DELETE FROM users', impact })

    impact.summary = '0 rows'
    impact.estimatedRows = 0

    expect(store.pending(view.proposalId)?.impact).toEqual({
      summary: '10 rows',
      estimatedRows: 10,
    })
  })
})
