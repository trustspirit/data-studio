import { describe, it, expect } from 'vitest'
import { createAiToolContext } from '@main/ai/createAiToolContext'

const deps = {
  executor: {} as never,
  connections: { list: () => Promise.resolve([]), get: () => Promise.resolve(null) },
  proposals: {} as never,
  redactor: { redact: (rs: never) => rs },
  sessionId: 'sess-1',
  newRequestId: () => 'req-1',
}

describe('createAiToolContext', () => {
  it('aiActor()를 {type:ai, sessionId}로 하드와이어한다', () => {
    const ctx = createAiToolContext(deps)
    expect(ctx.aiActor()).toEqual({ type: 'ai', sessionId: 'sess-1' })
  })
  it('sessionId/newRequestId를 그대로 노출한다', () => {
    const ctx = createAiToolContext(deps)
    expect(ctx.sessionId).toBe('sess-1')
    expect(ctx.newRequestId()).toBe('req-1')
  })
})
