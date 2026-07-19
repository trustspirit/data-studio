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

    return {
      proposalId: proposal.proposalId,
      connectionId: proposal.connectionId,
      statement: proposal.statement,
      statementHash: proposal.statementHash,
      impact: { ...proposal.impact },
      expiresAt: proposal.expiresAt,
    }
  }

  reject(proposalId: string): void {
    this.proposals.delete(proposalId)
  }

  /** 만료된 제안서를 버린다. 보관 자체가 문장 원문을 들고 있는 일이다. */
  sweep(): void {
    const now = this.deps.now()
    for (const [id, proposal] of this.proposals) {
      if (now >= proposal.expiresAt) this.proposals.delete(id)
    }
  }
}
