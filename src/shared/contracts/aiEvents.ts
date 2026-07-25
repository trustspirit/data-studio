/**
 * main→renderer AI 스트리밍 이벤트(`ai:event` push 채널 페이로드).
 *
 * renderer가 보는 세션 핸들은 **chatId**다 — `sessionId`는 AI actor 식별에 쓰이는
 * main 전용 개념이라 shared/preload에 등장하지 않는다(boundaries 테스트가 강제).
 * main이 만든 세션의 핸들을 되돌려 쓰는 것뿐, renderer가 정체성을 주장할 수 없다.
 *
 * tool_use는 **이름만** 노출한다 — tool 입력(SQL 원문 등)은 제안 승인 UI가
 * WriteProposalStore 경유로 따로 보여주며, 스트림 이벤트에는 싣지 않는다.
 */
export type AiStreamEvent =
  | { readonly type: 'text'; readonly delta: string }
  | { readonly type: 'thinking'; readonly delta: string }
  | { readonly type: 'tool_use'; readonly name: string }
  | { readonly type: 'done' }
  | { readonly type: 'error'; readonly message: string }

export interface AiEventPayload {
  readonly chatId: string
  readonly event: AiStreamEvent
}
