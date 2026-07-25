import { describe, it, expect, vi } from 'vitest'
import { AiOrchestrator, boundToolResult } from '@main/ai/AiOrchestrator'
import { fakeLlmProvider } from './fakeLlmProvider'
import type { ChatSink } from '@main/core/ports/LlmProvider'
import type { ToolRegistry } from '@main/ai/ToolRegistry'
import type { AiToolContext } from '@main/ai/AiToolContext'

function recordingSink(): ChatSink & { events: string[] } {
  const events: string[] = []
  return {
    events,
    onText: (d) => events.push(`text:${d}`),
    onThinking: (d) => events.push(`think:${d}`),
    onToolUse: (u) => events.push(`use:${u.name}`),
    onDone: () => events.push('done'),
    onError: (m) => events.push(`error:${m}`),
  }
}
const ctx = {} as AiToolContext

describe('AiOrchestrator', () => {
  it('tool_use 턴이면 invoke로 실행하고 결과를 다음 요청에 넣고 반복한다', async () => {
    const invoke = vi.fn(async () => ({ ok: true, data: { rows: [] } }))
    const registry = { invoke, specs: () => [] } as unknown as ToolRegistry
    const provider = fakeLlmProvider([
      { text: 'let me look', toolUses: [{ id: 't1', name: 'get_schema', input: { connectionId: 'c1' } }], stopReason: 'tool_use' },
      { text: 'here it is', toolUses: [], stopReason: 'end' },
    ])
    const orch = new AiOrchestrator({ provider, toolRegistry: registry, toolContext: ctx, systemPrompt: 'S', schemaContext: 'SCHEMA' })
    const sink = recordingSink()
    await orch.sendMessage('show schema', sink)

    expect(invoke).toHaveBeenCalledWith('get_schema', { connectionId: 'c1' }, ctx)
    // 2번째 요청의 messages에 tool_result가 들어가 있어야 한다.
    const secondReq = provider.calls[1]!
    expect(secondReq.messages.some((m) => m.role === 'tool_result')).toBe(true)
    expect(sink.events).toContain('use:get_schema')
    expect(sink.events).toContain('done')
  })

  it('tool 실패는 isError tool_result로 넣는다', async () => {
    const invoke = vi.fn(async () => ({ ok: false, error: 'denied' }))
    const registry = { invoke, specs: () => [] } as unknown as ToolRegistry
    const provider = fakeLlmProvider([
      { text: '', toolUses: [{ id: 't1', name: 'run_read_query', input: {} }], stopReason: 'tool_use' },
      { text: 'ok', toolUses: [], stopReason: 'end' },
    ])
    const orch = new AiOrchestrator({ provider, toolRegistry: registry, toolContext: ctx, systemPrompt: 'S', schemaContext: '' })
    await orch.sendMessage('q', recordingSink())
    const tr = provider.calls[1]!.messages.find((m) => m.role === 'tool_result')
    expect(tr).toMatchObject({ role: 'tool_result', isError: true })
  })

  it('반복 상한을 넘으면 onError로 끝낸다', async () => {
    const invoke = vi.fn(async () => ({ ok: true, data: {} }))
    const registry = { invoke, specs: () => [] } as unknown as ToolRegistry
    // 항상 tool_use만 내는 provider → 무한 루프 시도
    const provider = { id: 'anthropic' as const, chat: (_r: never, _s: never) => Promise.resolve({ text: '', toolUses: [{ id: 'x', name: 'get_schema', input: {} }], stopReason: 'tool_use' as const }) }
    const orch = new AiOrchestrator({ provider, toolRegistry: registry, toolContext: ctx, systemPrompt: 'S', schemaContext: '', maxRounds: 3 })
    const sink = recordingSink()
    await orch.sendMessage('q', sink)
    expect(sink.events.some((e) => e.startsWith('error:'))).toBe(true)
    expect(invoke).toHaveBeenCalledTimes(3)
  })

  it('boundToolResult는 100KB를 넘으면 절단한다', () => {
    const big = { data: 'x'.repeat(200 * 1024) }
    const out = boundToolResult({ ok: true, data: big })
    expect(out.length).toBeLessThanOrEqual(100 * 1024 + 64) // 절단 표시 여유
    expect(out).toContain('truncated')
  })

  it('boundToolResult는 글자 수가 아니라 UTF-8 바이트 수로 상한을 지킨다(한글/CJK)', () => {
    // '가'는 UTF-16 1 code unit이지만 UTF-8로는 3 bytes다.
    // 60 * 1024 chars → .length로는 100*1024 미만이지만 실제 바이트로는 180*1024로 상한 초과.
    const korean = { data: '가'.repeat(60 * 1024) }
    const raw = JSON.stringify(korean)
    expect(raw.length).toBeLessThan(100 * 1024)
    expect(Buffer.byteLength(raw, 'utf8')).toBeGreaterThan(100 * 1024)

    const out = boundToolResult({ ok: true, data: korean })
    expect(Buffer.byteLength(out, 'utf8')).toBeLessThanOrEqual(100 * 1024 + 64) // 절단 표시 여유
    expect(out).toContain('truncated')
  })

  it('boundToolResult는 상한 미만이면 절단하지 않는다(ASCII)', () => {
    const small = { data: 'hello world' }
    const out = boundToolResult({ ok: true, data: small })
    expect(out).not.toContain('truncated')
    expect(out).toBe(JSON.stringify(small))
  })

  it('이미 취소된 signal이면 provider/invoke를 호출하지 않고 즉시 onError로 끝낸다', async () => {
    const invoke = vi.fn(async () => ({ ok: true, data: {} }))
    const registry = { invoke, specs: () => [] } as unknown as ToolRegistry
    const chat = vi.fn(async () => ({ text: '', toolUses: [], stopReason: 'end' as const }))
    const provider = { id: 'anthropic' as const, chat }
    const orch = new AiOrchestrator({ provider, toolRegistry: registry, toolContext: ctx, systemPrompt: 'S', schemaContext: '' })
    const sink = recordingSink()
    const controller = new AbortController()
    controller.abort()

    await orch.sendMessage('q', sink, controller.signal)

    expect(sink.events.some((e) => e.startsWith('error:'))).toBe(true)
    expect(chat).not.toHaveBeenCalled()
    expect(invoke).not.toHaveBeenCalled()
  })
})
