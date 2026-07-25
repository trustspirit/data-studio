import type { AiStreamEvent } from '../../../shared/contracts/aiEvents'
import type { LlmProviderIdDto } from '../../../shared/contracts/ipcContract'

export type AiProviderId = LlmProviderIdDto

export interface AiKeyStatus {
  readonly anthropic: boolean
  readonly openai: boolean
}

export type AiSendOutcome =
  | { readonly accepted: true }
  | { readonly accepted: false; readonly reason: string }

/**
 * AI 쓰기 제안의 renderer 뷰. main의 `ProposalView`가 IPC로 넘어온 형태를
 * 구조만 맞춰 다시 적는다 — renderer는 main을 import하지 않는다.
 *
 * `statement`는 **표시용**이다. 승인은 `proposalId`만 되돌려 보내며, 실행은
 * main이 보관한 원문으로만 이뤄진다.
 */
export interface AiProposal {
  readonly proposalId: string
  readonly connectionId: string
  readonly statement: string
  readonly statementHash: string
  readonly kind: 'write' | 'analyze'
  readonly impact: { readonly summary: string; readonly estimatedRows: number | null }
  readonly expiresAt: number
}

/**
 * feature가 AI 채팅·키 관리·제안 조회에 의존하는 인터페이스.
 *
 * 승인(실행)은 여기 없다 — 그것은 `OperationGateway.run` + `proposalId`의
 * 몫이다. 이 게이트웨이는 세션·스트림·키·제안 목록만 다룬다.
 */
export interface AiGateway {
  newSession(provider: AiProviderId): Promise<{ chatId: string }>
  /** 수락 여부만 즉시 돌아온다. 스트리밍은 `onEvent`로 온다. */
  send(chatId: string, text: string): Promise<AiSendOutcome>
  cancel(chatId: string): Promise<void>
  keyStatus(): Promise<AiKeyStatus>
  setKey(provider: AiProviderId, value: string): Promise<void>
  deleteKey(provider: AiProviderId): Promise<void>
  proposals(connectionId: string): Promise<readonly AiProposal[]>
  rejectProposal(proposalId: string, connectionId: string): Promise<boolean>
  /**
   * AI 스트림 이벤트 구독. main이 push하는 이벤트 중 이 chatId의 것만
   * listener로 전달한다. 반환값은 해제 함수다.
   */
  onEvent(chatId: string, listener: (event: AiStreamEvent) => void): () => void
}
