import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createHandlerRegistrar, IpcFailure } from '@main/ipc/registerHandler'
import type { InvokeEventLike } from '@main/security/senderGuard'

const OK_EVENT = {
  senderFrame: { url: 'app://ok/' },
  sender: { mainFrame: { url: 'app://ok/' } },
} satisfies InvokeEventLike

function createHarness(guardResult: boolean) {
  const registered = new Map<
    string,
    (event: InvokeEventLike, input: unknown) => Promise<unknown>
  >()

  const logger = { warn: vi.fn() }

  const register = createHandlerRegistrar({
    handle: (channel, handler) => registered.set(channel, handler),
    guard: () => guardResult,
    logger,
  })

  return {
    register,
    logger,
    invoke: (channel: string, input: unknown) => {
      const handler = registered.get(channel)
      if (handler === undefined) throw new Error(`channel not registered: ${channel}`)
      return handler(OK_EVENT, input)
    },
  }
}

describe('createHandlerRegistrar', () => {
  it('검증을 통과한 입력을 핸들러에 넘긴다', async () => {
    const harness = createHarness(true)
    harness.register('math:double', z.object({ n: z.number() }), async ({ n }) => n * 2)

    await expect(harness.invoke('math:double', { n: 21 })).resolves.toBe(42)
  })

  it('sender 검증 실패 시 핸들러를 호출하지 않고 거부한다', async () => {
    const harness = createHarness(false)
    const handler = vi.fn()
    harness.register('math:double', z.object({ n: z.number() }), handler)

    await expect(harness.invoke('math:double', { n: 1 })).rejects.toThrow(IpcFailure)
    expect(handler).not.toHaveBeenCalled()
  })

  it('sender 검증 실패를 로그에 남긴다', async () => {
    const harness = createHarness(false)
    harness.register('math:double', z.object({ n: z.number() }), async () => 0)

    await harness.invoke('math:double', { n: 1 }).catch(() => undefined)

    expect(harness.logger.warn).toHaveBeenCalledWith(
      'ipc.forbidden_sender',
      expect.objectContaining({ channel: 'math:double' }),
    )
  })

  it('sender 검증과 스키마 검증이 모두 실패해도 forbidden_sender로 거부한다', async () => {
    const harness = createHarness(false)
    const handler = vi.fn()
    harness.register('math:double', z.strictObject({ n: z.number() }), handler)

    await expect(
      harness.invoke('math:double', { n: 'not a number' }),
    ).rejects.toMatchObject({ code: 'forbidden_sender' })
    expect(handler).not.toHaveBeenCalled()
  })

  it('sender 검증과 스키마 검증이 모두 실패하면 forbidden_sender만 로그에 남긴다', async () => {
    const harness = createHarness(false)
    harness.register('math:double', z.strictObject({ n: z.number() }), async () => 0)

    await harness.invoke('math:double', { n: 'not a number' }).catch(() => undefined)

    expect(harness.logger.warn).toHaveBeenCalledWith(
      'ipc.forbidden_sender',
      expect.objectContaining({ channel: 'math:double' }),
    )
    expect(harness.logger.warn).not.toHaveBeenCalledWith(
      'ipc.invalid_input',
      expect.anything(),
    )
  })

  it('스키마에 맞지 않는 입력을 거부한다', async () => {
    const harness = createHarness(true)
    const handler = vi.fn()
    harness.register('math:double', z.object({ n: z.number() }), handler)

    await expect(harness.invoke('math:double', { n: 'not a number' })).rejects.toThrow(
      IpcFailure,
    )
    expect(handler).not.toHaveBeenCalled()
  })

  it('알 수 없는 프로퍼티가 붙은 입력을 거부한다', async () => {
    const harness = createHarness(true)
    const handler = vi.fn()
    harness.register('math:double', z.strictObject({ n: z.number() }), handler)

    await expect(
      harness.invoke('math:double', { n: 1, origin: 'user' }),
    ).rejects.toThrow(IpcFailure)
    expect(handler).not.toHaveBeenCalled()
  })

  it('거부 오류에 코드를 담는다', async () => {
    const harness = createHarness(true)
    harness.register('math:double', z.object({ n: z.number() }), async () => 0)

    await expect(harness.invoke('math:double', {})).rejects.toMatchObject({
      code: 'invalid_input',
    })
  })
})
