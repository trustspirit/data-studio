import { describe, expect, it, vi } from 'vitest'
import { createContractRegistrar } from '@main/ipc/registerHandler'
import type { InvokeEventLike } from '@main/security/senderGuard'

const OK_EVENT = {
  senderFrame: { url: 'app://ok/' },
  sender: { mainFrame: { url: 'app://ok/' } },
} satisfies InvokeEventLike

function createHarness() {
  const registered = new Map<
    string,
    (event: InvokeEventLike, input: unknown) => Promise<unknown>
  >()

  const register = createContractRegistrar({
    handle: (channel, handler) => registered.set(channel, handler),
    guard: () => true,
    logger: { warn: vi.fn() },
  })

  return {
    register,
    invoke: (channel: string, input: unknown) => {
      const handler = registered.get(channel)
      if (handler === undefined) throw new Error(`channel not registered: ${channel}`)
      return handler(OK_EVENT, input)
    },
  }
}

describe('createContractRegistrar', () => {
  it('채널에 묶인 스키마로 입력을 검증한다', async () => {
    // operation:cancel의 계약 스키마는 { requestId: string }이다. 핸들러가
    // 스키마를 넘기지 않았는데도 그 검증이 걸린다.
    const h = createHarness()
    h.register('operation:cancel', (input) => Promise.resolve(input.requestId))

    await expect(h.invoke('operation:cancel', { requestId: 'r1' })).resolves.toEqual({
      ok: true,
      value: 'r1',
    })
  })

  it('채널 스키마에 맞지 않는 입력을 거부한다', async () => {
    const h = createHarness()
    h.register('operation:cancel', (input) => Promise.resolve(input.requestId))

    // requestId가 빠졌다 — 계약 스키마가 거부한다.
    await expect(h.invoke('operation:cancel', {})).resolves.toEqual({
      ok: false,
      code: 'invalid_input',
    })
  })

  it('operation:run 핸들러는 위조된 actor를 보지 못한다', async () => {
    // 스키마가 actor를 strip하므로, 핸들러가 받는 입력에는 actor가 없다.
    const h = createHarness()
    let seen: Record<string, unknown> = {}
    h.register('operation:run', (input) => {
      seen = input
      return Promise.resolve(null)
    })

    await h.invoke('operation:run', {
      requestId: 'r1',
      connectionId: 'c1',
      operation: { kind: 'sql', sql: 'SELECT 1' },
      actor: { type: 'user' },
    })

    expect('actor' in seen).toBe(false)
  })
})
