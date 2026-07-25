import { describe, it, expect } from 'vitest'
import {
  createOpenAiProvider,
  toOpenAiTools,
  toOpenAiMessages,
  mapOpenAiFinishReason,
  type OpenAiClientLike,
  type OpenAiStreamEvent,
} from '@main/ai/providers/openaiAdapter'
import type { ChatSink } from '@main/core/ports/LlmProvider'

function sink(): ChatSink & { events: string[] } {
  const events: string[] = []
  return { events, onText: (d) => events.push(`t:${d}`), onThinking: () => events.push('k'), onToolUse: (u) => events.push(`u:${u.name}`), onDone: () => {}, onError: () => {} }
}

describe('openai converters', () => {
  it('toOpenAiTools: function 형태로 변환', () => {
    expect(toOpenAiTools([{ name: 'get_schema', description: 'd', inputSchema: { type: 'object' } }])).toEqual([
      { type: 'function', function: { name: 'get_schema', description: 'd', parameters: { type: 'object' } } },
    ])
  })
  it('toOpenAiMessages: tool_result는 role:tool로', () => {
    const out = toOpenAiMessages([
      { role: 'user', text: 'hi' },
      { role: 'tool_result', toolUseId: 'i1', content: '{}', isError: false },
    ])
    expect(out[0]).toEqual({ role: 'user', content: 'hi' })
    expect(out[1]).toMatchObject({ role: 'tool', tool_call_id: 'i1', content: '{}' })
  })
  it('mapOpenAiFinishReason', () => {
    expect(mapOpenAiFinishReason('stop')).toBe('end')
    expect(mapOpenAiFinishReason('tool_calls')).toBe('tool_use')
    expect(mapOpenAiFinishReason('length')).toBe('max_tokens')
  })
})

describe('createOpenAiProvider.chat', () => {
  function clientYielding(events: OpenAiStreamEvent[]): OpenAiClientLike {
    return {
      stream: () =>
        // eslint-disable-next-line @typescript-eslint/require-await -- fake async iterable; no real awaiting needed
        (async function* () {
          for (const e of events) yield e
        })(),
    }
  }
  it('스트림을 sink로 옮기고 ChatTurnResult를 만든다', async () => {
    const events: OpenAiStreamEvent[] = [
      { type: 'text', text: 'hi' },
      { type: 'tool_use', id: 'u1', name: 'get_schema', input: { connectionId: 'c1' } },
      { type: 'stop', finishReason: 'tool_calls' },
    ]
    const provider = createOpenAiProvider({
      secrets: { get: () => Promise.resolve('sk'), set: () => Promise.resolve(), delete: () => Promise.resolve(), isPersistent: () => true },
      createClient: () => clientYielding(events),
    })
    const s = sink()
    const turn = await provider.chat({ system: 'S', messages: [{ role: 'user', text: 'q' }], tools: [] }, s)
    expect(turn.text).toBe('hi')
    expect(turn.toolUses).toEqual([{ id: 'u1', name: 'get_schema', input: { connectionId: 'c1' } }])
    expect(turn.stopReason).toBe('tool_use')
    expect(s.events).toEqual(['t:hi', 'u:get_schema'])
  })
  it('API 키가 없으면 던진다', async () => {
    const provider = createOpenAiProvider({ secrets: { get: () => Promise.resolve(null), set: () => Promise.resolve(), delete: () => Promise.resolve(), isPersistent: () => true }, createClient: () => clientYielding([]) })
    await expect(provider.chat({ system: 'S', messages: [], tools: [] }, sink())).rejects.toThrow(/api key/i)
  })
})
