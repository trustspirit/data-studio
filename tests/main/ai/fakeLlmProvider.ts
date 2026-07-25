import type { ChatRequest, ChatSink, ChatTurnResult, LlmProvider } from '@main/core/ports/LlmProvider'

/** 미리 스크립트한 턴을 순서대로 돌려주는 fake. 각 turn은 sink로도 방출한다. */
export function fakeLlmProvider(turns: readonly ChatTurnResult[]): LlmProvider & { calls: ChatRequest[] } {
  const calls: ChatRequest[] = []
  let i = 0
  return {
    id: 'anthropic',
    calls,
    chat: (req: ChatRequest, sink: ChatSink): Promise<ChatTurnResult> => {
      calls.push(req)
      const turn = turns[i] ?? { text: '', toolUses: [], stopReason: 'end' as const }
      i += 1
      if (turn.text !== '') sink.onText(turn.text)
      for (const use of turn.toolUses) sink.onToolUse(use)
      return Promise.resolve(turn)
    },
  }
}
