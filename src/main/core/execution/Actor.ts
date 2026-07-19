/**
 * 사용자가 특정 쓰기 제안서를 승인했다는 표식. `proposalId`만 담는다 —
 * 문장 원문은 main의 WriteProposalStore에만 있다.
 */
export interface WriteGrant {
  readonly proposalId: string
}

/**
 * 요청의 주체.
 *
 * **이 타입은 IPC DTO에 절대 들어가지 않는다.** renderer가 보낸 값으로 권한을
 * 결정하면 XSS 하나로 `{ type: 'user' }`를 위조해 승인 게이트 전체가
 * 무의미해진다. actor는 언제나 **main의 호출 경로**가 만든다: 사용자 IPC
 * 핸들러가 `{ type: 'user' }`를, AI 오케스트레이터의 tool 호출이
 * `{ type: 'ai' }`를 만든다.
 */
export type Actor =
  | { readonly type: 'user'; readonly grant: WriteGrant | null }
  | { readonly type: 'ai'; readonly sessionId: string }
