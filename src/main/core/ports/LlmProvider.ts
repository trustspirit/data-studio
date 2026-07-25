export type ProviderId = 'anthropic' | 'openai'

export interface ToolUse {
  readonly id: string
  readonly name: string
  readonly input: unknown
}

/** 프로바이더-중립 대화 메시지. 어댑터가 각 SDK 형식으로 변환한다. */
export type ChatMessage =
  | { readonly role: 'user'; readonly text: string }
  | { readonly role: 'assistant'; readonly text: string; readonly toolUses: readonly ToolUse[] }
  | { readonly role: 'tool_result'; readonly toolUseId: string; readonly content: string; readonly isError: boolean }

/**
 * LLM에 노출되는 tool 스펙. 구조가 6a `AiToolSpec`와 같아 `ToolRegistry.specs()`
 * 결과가 그대로 대입된다 — 포트가 ai를 import하지 않도록 여기서 인라인 정의한다.
 */
export interface LlmToolSpec {
  readonly name: string
  readonly description: string
  readonly inputSchema: unknown
}

export interface ChatRequest {
  /** 시스템 프롬프트 + 스키마 컨텍스트(캐시 프리픽스). */
  readonly system: string
  readonly messages: readonly ChatMessage[]
  readonly tools: readonly LlmToolSpec[]
  readonly model?: string
  readonly maxTokens?: number
}

/** 스트리밍 델타 싱크. 6c가 push 채널로 연결한다. */
export interface ChatSink {
  onText(delta: string): void
  onThinking(delta: string): void
  onToolUse(use: ToolUse): void
  onDone(): void
  onError(message: string): void
}

export type StopReason = 'end' | 'tool_use' | 'max_tokens' | 'error'

export interface ChatTurnResult {
  readonly text: string
  readonly toolUses: readonly ToolUse[]
  readonly stopReason: StopReason
}

/**
 * 어시스턴트 1턴. **tool을 실행하지 않는다** — 텍스트/생각을 sink로 스트리밍하고
 * tool_use 요청을 반환할 뿐이다. tool 실행은 AiOrchestrator가 관문 경유로 한다.
 */
export interface LlmProvider {
  readonly id: ProviderId
  chat(req: ChatRequest, sink: ChatSink): Promise<ChatTurnResult>
}
