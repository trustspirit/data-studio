import { describe, expect, it, vi } from 'vitest'
import { registerIpcRoutes, type ContractRegister } from '@main/app/ipcRoutes'
import type { AppServices } from '@main/app/compositionRoot'
import type { CallerContext } from '@main/ipc/CallerContext'

const CONTEXT: CallerContext = { source: 'renderer-ui' }

describe('connection:open capabilities', () => {
  it('connection:open은 열린 드라이버의 capabilities를 반환한다', async () => {
    const handlers = new Map<string, (input: unknown, ctx: CallerContext) => Promise<unknown>>()
    const register = ((channel, handler) => {
      handlers.set(channel, handler as (input: unknown, ctx: CallerContext) => Promise<unknown>)
    }) as ContractRegister
    const release = vi.fn()
    const fakeDriver = { id: 'c1', engine: 'postgres', sql: {}, schema: {}, data: {} }
    const services = {
      repository: { get: () => Promise.resolve({ id: 'c1', engine: 'postgres' }) },
      connections: {
        open: () => Promise.resolve(),
        acquire: () =>
          Promise.resolve({ driver: fakeDriver, signal: new AbortController().signal, release }),
      },
    } as unknown as AppServices

    registerIpcRoutes(register, services)
    const result = await handlers.get('connection:open')!({ connectionId: 'c1' }, CONTEXT)

    expect(result).toMatchObject({ opened: true, capabilities: ['sql', 'schema', 'data'] })
    expect(release).toHaveBeenCalled()
  })

  it('없는 커넥션은 opened:false를 반환한다', async () => {
    const handlers = new Map<string, (input: unknown, ctx: CallerContext) => Promise<unknown>>()
    const register = ((channel, handler) => {
      handlers.set(channel, handler as (input: unknown, ctx: CallerContext) => Promise<unknown>)
    }) as ContractRegister
    const services = {
      repository: { get: () => Promise.resolve(null) },
    } as unknown as AppServices

    registerIpcRoutes(register, services)
    const result = await handlers.get('connection:open')!({ connectionId: 'nope' }, CONTEXT)

    expect(result).toMatchObject({ opened: false })
  })
})
