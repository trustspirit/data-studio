export interface ImpactAnalysis {
  readonly summary: string
  readonly estimatedRows: number | null
}

interface StoredProposal {
  readonly proposalId: string
  readonly connectionId: string
  readonly statementHash: string
  /** main에만 보관한다. 실행은 언제나 이 값으로 한다. */
  readonly statement: string
  readonly impact: ImpactAnalysis
  readonly createdAt: number
  readonly expiresAt: number
  consumed: boolean
}

/** renderer에 보내는 표현. 함수를 담지 않아 structuredClone 가능하다. */
export interface ProposalView {
  readonly proposalId: string
  readonly connectionId: string
  readonly statement: string
  readonly statementHash: string
  readonly impact: ImpactAnalysis
  readonly expiresAt: number
}

export type ConsumeResult =
  | { readonly ok: true; readonly statement: string; readonly statementHash: string }
  | {
      readonly ok: false
      readonly reason: 'not_found' | 'expired' | 'consumed' | 'connection_mismatch'
    }

export interface ProposalInput {
  readonly connectionId: string
  readonly statement: string
  readonly impact: ImpactAnalysis
}

export interface ProposalDeps {
  readonly now: () => number
  /**
   * **암호학적으로 안전한 난수여야 한다.**
   *
   * `proposalId`는 renderer로 나가고 renderer가 그대로 되돌려 보내는 유일한
   * 승인 증표다. 추측 가능한 id면 침해된 renderer가 사용자가 아직 승인하지
   * 않은 제안서를 맞혀 승인시킬 수 있다 — 커넥션 검사도 1회용도 막지 못한다
   * (renderer가 connectionId를 스스로 보내고, 한 번 맞히면 그것으로 끝이다).
   * 이 보장은 전적으로 주입하는 쪽 책임이므로 여기 적어 둔다.
   *
   * 다만 위험은 한정적이다: id를 맞혀도 AI가 이미 제안한 문장이 실행될 뿐,
   * 새 SQL을 지어낼 수는 없다.
   */
  readonly randomId: () => string
  readonly hash: (text: string) => string
}

export const PROPOSAL_TTL_MS = 5 * 60 * 1000

/**
 * AI가 제안한 쓰기를 보관한다.
 *
 * **이것은 UX 확인이 아니라 보안 통제다.** renderer는 `proposalId`만 되돌려
 * 보내고, 실행은 여기 보관된 원문으로만 한다 — renderer가 SQL을 함께 보내는
 * 설계였다면 위조된 SQL을 승인 토큰에 실어 보낼 수 있다.
 *
 * 시계·난수·해시를 주입받는 이유: 만료와 1회용은 시간에 의존하므로 실제
 * 시계로는 결정적으로 테스트할 수 없다.
 */
export class WriteProposalStore {
  private readonly proposals = new Map<string, StoredProposal>()

  constructor(private readonly deps: ProposalDeps) {}

  propose(input: ProposalInput): ProposalView {
    const createdAt = this.deps.now()
    const proposal: StoredProposal = {
      proposalId: this.deps.randomId(),
      connectionId: input.connectionId,
      statementHash: this.deps.hash(input.statement),
      statement: input.statement,
      impact: { ...input.impact },
      createdAt,
      expiresAt: createdAt + PROPOSAL_TTL_MS,
      consumed: false,
    }

    if (this.proposals.has(proposal.proposalId)) {
      // id 충돌은 조용히 덮어쓰면 안 된다 — 살아 있는 제안서가 사라지고,
      // 사용자가 승인 화면에서 본 것과 다른 문장이 그 id에 붙는다.
      throw new Error(`proposal id collision: ${proposal.proposalId}`)
    }

    this.proposals.set(proposal.proposalId, proposal)

    // 보관본과 뷰는 별개의 객체다. 같은 객체를 넘기면 표시용 값을 만지는 코드
    // 하나가 실제로 실행될 문장을 바꿀 수 있다.
    return {
      proposalId: proposal.proposalId,
      connectionId: proposal.connectionId,
      statement: proposal.statement,
      statementHash: proposal.statementHash,
      impact: { ...proposal.impact },
      expiresAt: proposal.expiresAt,
    }
  }

  consume(proposalId: string, connectionId: string): ConsumeResult {
    const proposal = this.proposals.get(proposalId)
    if (proposal === undefined) return { ok: false, reason: 'not_found' }
    if (proposal.consumed) return { ok: false, reason: 'consumed' }
    if (this.deps.now() >= proposal.expiresAt) return { ok: false, reason: 'expired' }

    // 커넥션 불일치는 소비 **전에** 본다. 여기서 태워 없애면, 잘못 겨눈 시도
    // 하나가 사용자의 정상 승인을 무효로 만든다.
    if (proposal.connectionId !== connectionId) {
      return { ok: false, reason: 'connection_mismatch' }
    }

    proposal.consumed = true

    return { ok: true, statement: proposal.statement, statementHash: proposal.statementHash }
  }

  /**
   * 보관 중인 제안서를 들여다본다. 승인 UI에 다시 표시하거나 감사할 때 쓴다.
   * 소비하지 않으며, 뷰와 마찬가지로 보관본을 공유하지 않는다.
   */
  pending(proposalId: string): ProposalView | null {
    const proposal = this.proposals.get(proposalId)
    if (proposal === undefined) return null
    // 이름 그대로 "아직 승인 대기 중인" 것만 준다. 소비됐거나 만료된 제안서를
    // 살아 있는 것처럼 돌려주면 승인 UI가 죽은 제안서를 승인 가능한 것으로
    // 그리고, 사용자의 클릭이 consume에서야 실패한다.
    if (proposal.consumed) return null
    if (this.deps.now() >= proposal.expiresAt) return null

    return {
      proposalId: proposal.proposalId,
      connectionId: proposal.connectionId,
      statement: proposal.statement,
      statementHash: proposal.statementHash,
      impact: { ...proposal.impact },
      expiresAt: proposal.expiresAt,
    }
  }

  /**
   * 제안서를 버린다. `consume`과 같은 기준으로 커넥션을 확인한다 — 한쪽만
   * 검사하면 id를 쥔 아무 호출자나 남의 커넥션 제안서를 지울 수 있다.
   *
   * 실제로 무언가를 지웠는지 돌려준다. 감사 로그(Task 5)가 "실재하는 제안서를
   * 거부했다"와 "모르는 id를 거부했다"를 구분할 수 있어야 한다.
   */
  reject(proposalId: string, connectionId: string): boolean {
    const proposal = this.proposals.get(proposalId)
    if (proposal === undefined) return false
    if (proposal.connectionId !== connectionId) return false

    this.proposals.delete(proposalId)
    return true
  }

  /**
   * 더 쓸 수 없는 제안서를 버린다. 보관 자체가 문장 원문을 들고 있는 일이므로,
   * 만료된 것뿐 아니라 **이미 소비된 것도** 지운다 — 소비된 제안서를 TTL까지
   * 들고 있을 이유가 없다.
   */
  sweep(): void {
    const now = this.deps.now()
    for (const [id, proposal] of this.proposals) {
      if (proposal.consumed || now >= proposal.expiresAt) this.proposals.delete(id)
    }
  }
}
