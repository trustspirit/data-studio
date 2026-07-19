import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createHandlerRegistrar, IpcFailure } from '@main/ipc/registerHandler'
import type { InvokeEventLike } from '@main/security/senderGuard'
import type { CallerContext } from '@main/ipc/CallerContext'

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
  it('검증을 통과한 입력을 핸들러에 넘기고 ok 결과로 감싼다', async () => {
    const harness = createHarness(true)
    harness.register('math:double', z.object({ n: z.number() }), ({ n }) => Promise.resolve(n * 2))

    await expect(harness.invoke('math:double', { n: 21 })).resolves.toEqual({
      ok: true,
      value: 42,
    })
  })

  it('sender 검증 실패 시 핸들러를 호출하지 않고 실패 결과를 반환한다 (던지지 않는다)', async () => {
    const harness = createHarness(false)
    const handler = vi.fn()
    harness.register('math:double', z.object({ n: z.number() }), handler)

    await expect(harness.invoke('math:double', { n: 1 })).resolves.toEqual({
      ok: false,
      code: 'forbidden_sender',
    })
    expect(handler).not.toHaveBeenCalled()
  })

  it('sender 검증 실패를 로그에 남긴다', async () => {
    const harness = createHarness(false)
    harness.register('math:double', z.object({ n: z.number() }), () => Promise.resolve(0))

    await harness.invoke('math:double', { n: 1 })

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
    ).resolves.toEqual({ ok: false, code: 'forbidden_sender' })
    expect(handler).not.toHaveBeenCalled()
  })

  it('sender 검증과 스키마 검증이 모두 실패하면 forbidden_sender만 로그에 남긴다', async () => {
    const harness = createHarness(false)
    harness.register('math:double', z.strictObject({ n: z.number() }), () => Promise.resolve(0))

    await harness.invoke('math:double', { n: 'not a number' })

    expect(harness.logger.warn).toHaveBeenCalledWith(
      'ipc.forbidden_sender',
      expect.objectContaining({ channel: 'math:double' }),
    )
    expect(harness.logger.warn).not.toHaveBeenCalledWith(
      'ipc.invalid_input',
      expect.anything(),
    )
  })

  it('스키마에 맞지 않는 입력을 실패 결과로 거부한다', async () => {
    const harness = createHarness(true)
    const handler = vi.fn()
    harness.register('math:double', z.object({ n: z.number() }), handler)

    await expect(harness.invoke('math:double', { n: 'not a number' })).resolves.toEqual({
      ok: false,
      code: 'invalid_input',
    })
    expect(handler).not.toHaveBeenCalled()
  })

  it('알 수 없는 프로퍼티가 붙은 입력을 거부한다', async () => {
    const harness = createHarness(true)
    const handler = vi.fn()
    harness.register('math:double', z.strictObject({ n: z.number() }), handler)

    await expect(
      harness.invoke('math:double', { n: 1, origin: 'user' }),
    ).resolves.toEqual({ ok: false, code: 'invalid_input' })
    expect(handler).not.toHaveBeenCalled()
  })

  it('핸들러가 받는 컨텍스트는 페이로드 내용과 무관하게 main이 결정한다', async () => {
    const harness = createHarness(true)
    let received: CallerContext | undefined
    harness.register(
      'math:double',
      z.object({ n: z.number() }),
      (input, context) => {
        received = context
        return Promise.resolve(input.n * 2)
      },
    )

    // 페이로드 안에 source: 'ai'를 심어도 핸들러가 받는 컨텍스트는 영향받지 않아야 한다.
    await harness.invoke('math:double', { n: 21, source: 'ai' })

    expect(received).toEqual({ source: 'renderer-ui' })
  })

  it('실패 결과에 코드가 담겨 있다 (던져진 오류가 아니라 반환값에)', async () => {
    const harness = createHarness(true)
    harness.register('math:double', z.object({ n: z.number() }), () => Promise.resolve(0))

    const result = await harness.invoke('math:double', {})

    expect(result).toMatchObject({ ok: false, code: 'invalid_input' })
  })

  it('핸들러가 IpcFailure가 아닌 예외를 던지면 일반 코드로 감싸고 원본 메시지를 renderer로 넘기지 않는다', async () => {
    const harness = createHarness(true)
    harness.register('math:double', z.object({ n: z.number() }), () => {
      throw new Error('leaked db connection string: postgres://user:hunter2@host/db')
    })

    const result = await harness.invoke('math:double', { n: 1 })

    expect(result).toEqual({ ok: false, code: 'internal_error' })
    expect(JSON.stringify(result)).not.toContain('hunter2')
  })

  it('핸들러가 IpcFailure가 아닌 예외를 던지면 실제 오류를 main 로그에 남긴다', async () => {
    const harness = createHarness(true)
    harness.register('math:double', z.object({ n: z.number() }), () => {
      throw new Error('boom')
    })

    await harness.invoke('math:double', { n: 1 })

    expect(harness.logger.warn).toHaveBeenCalledWith(
      'ipc.unexpected_error',
      expect.objectContaining({ channel: 'math:double', message: 'boom' }),
    )
  })

  it('핸들러가 IpcFailure를 직접 던지면 해당 코드를 결과에 담는다', async () => {
    const harness = createHarness(true)
    harness.register('math:double', z.object({ n: z.number() }), () => {
      throw new IpcFailure('invalid_input', 'domain-level rejection')
    })

    await expect(harness.invoke('math:double', { n: 1 })).resolves.toEqual({
      ok: false,
      code: 'invalid_input',
    })
  })
})
