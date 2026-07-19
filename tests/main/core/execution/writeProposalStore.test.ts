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

    store.reject(view.proposalId)

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
