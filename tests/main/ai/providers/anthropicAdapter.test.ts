import { describe, it, expect } from 'vitest'
import {
  createAnthropicProvider,
  toAnthropicTools,
  toAnthropicMessages,
  mapStopReason,
  type AnthropicClientLike,
  type AnthropicStreamEvent,
} from '@main/ai/providers/anthropicAdapter'
import type { ChatSink } from '@main/core/ports/LlmProvider'

function sink(): ChatSink & { events: string[] } {
  const events: string[] = []
  return {
    events,
    onText: (d) => events.push(`t:${d}`),
    onThinking: (d) => events.push(`k:${d}`),
    onToolUse: (u) => events.push(`u:${u.name}`),
    onDone: () => {},
    onError: () => {},
  }
}

describe('anthropic converters', () => {
  it('toAnthropicTools: name/description/input_schema로 변환', () => {
    const out = toAnthropicTools([{ name: 'get_schema', description: 'd', inputSchema: { type: 'object' } }])
    expect(out).toEqual([{ name: 'get_schema', description: 'd', input_schema: { type: 'object' } }])
  })
  it('toAnthropicMessages: user/assistant/tool_result 변환', () => {
    const out = toAnthropicMessages([
      { role: 'user', text: 'hi' },
      { role: 'assistant', text: 'ok', toolUses: [{ id: 'i1', name: 'get_schema', input: { a: 1 } }] },
      { role: 'tool_result', toolUseId: 'i1', content: '{}', isError: false },
    ])
    expect(out[0]).toEqual({ role: 'user', content: [{ type: 'text', text: 'hi' }] })
    expect(out[1]).toMatchObject({ role: 'assistant' })
    expect(out[2]).toMatchObject({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'i1', is_error: false }] })
  })
  it('mapStopReason', () => {
    expect(mapStopReason('end_turn')).toBe('end')
    expect(mapStopReason('tool_use')).toBe('tool_use')
    expect(mapStopReason('max_tokens')).toBe('max_tokens')
    expect(mapStopReason('unknown')).toBe('end')
  })
})

describe('createAnthropicProvider.chat', () => {
  function clientYielding(events: AnthropicStreamEvent[]): AnthropicClientLike {
    return {
      stream: () =>
        // eslint-disable-next-line @typescript-eslint/require-await -- fake async iterable; no real awaiting needed
        (async function* () {
          for (const e of events) yield e
        })(),
    }
  }

  it('스트림을 sink로 옮기고 ChatTurnResult를 만든다', async () => {
    const events: AnthropicStreamEvent[] = [
      { type: 'text', text: 'hello ' },
      { type: 'text', text: 'world' },
      { type: 'tool_use', id: 'u1', name: 'get_schema', input: { connectionId: 'c1' } },
      { type: 'stop', stopReason: 'tool_use' },
    ]
    const provider = createAnthropicProvider({
      secrets: {
        get: () => Promise.resolve('sk-test'),
        set: () => Promise.resolve(),
        delete: () => Promise.resolve(),
        isPersistent: () => true,
      },
      createClient: () => clientYielding(events),
    })
    const s = sink()
    const turn = await provider.chat({ system: 'S', messages: [{ role: 'user', text: 'q' }], tools: [] }, s)
    expect(turn.text).toBe('hello world')
    expect(turn.toolUses).toEqual([{ id: 'u1', name: 'get_schema', input: { connectionId: 'c1' } }])
    expect(turn.stopReason).toBe('tool_use')
    expect(s.events).toEqual(['t:hello ', 't:world', 'u:get_schema'])
  })

  it('API 키가 없으면 던진다', async () => {
    const provider = createAnthropicProvider({
      secrets: {
        get: () => Promise.resolve(null),
        set: () => Promise.resolve(),
        delete: () => Promise.resolve(),
        isPersistent: () => true,
      },
      createClient: () => clientYielding([]),
    })
    await expect(provider.chat({ system: 'S', messages: [], tools: [] }, sink())).rejects.toThrow(/api key/i)
  })
})

const LIVE = process.env.ANTHROPIC_API_KEY
const liveIt = LIVE ? it : it.skip
liveIt(
  'live: 실제 1턴 왕복',
  async () => {
    const provider = createAnthropicProvider({
      secrets: {
        get: () => Promise.resolve(LIVE ?? null),
        set: () => Promise.resolve(),
        delete: () => Promise.resolve(),
        isPersistent: () => true,
      },
    })
    const s = sink()
    const turn = await provider.chat(
      { system: 'You are terse.', messages: [{ role: 'user', text: 'Say only the word OK.' }], tools: [], maxTokens: 16 },
      s,
    )
    expect(turn.stopReason).toBe('end')
    expect(turn.text.length).toBeGreaterThan(0)
  },
  30_000,
)
