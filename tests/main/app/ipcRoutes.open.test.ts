import { describe, expect, it } from 'vitest'
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
    const services = {
      repository: { get: () => Promise.resolve({ id: 'c1', engine: 'postgres' }) },
      connections: {
        open: () => Promise.resolve(),
        capabilities: () => ['sql', 'schema', 'data'],
      },
    } as unknown as AppServices

    registerIpcRoutes(register, services)
    const result = await handlers.get('connection:open')!({ connectionId: 'c1' }, CONTEXT)

    expect(result).toMatchObject({
      opened: true,
      capabilities: ['sql', 'schema', 'data'],
      // AI 계정이 설정되지 않은 커넥션은 'none'이다.
      aiAccount: 'none',
    })
  })

  it('aiReadOnlyUsername이 있으면 파생 커넥션(::ai)도 AI 계정으로 연다', async () => {
    const handlers = new Map<string, (input: unknown, ctx: CallerContext) => Promise<unknown>>()
    const register = ((channel, handler) => {
      handlers.set(channel, handler as (input: unknown, ctx: CallerContext) => Promise<unknown>)
    }) as ContractRegister
    const opened: { id: string; username: string }[] = []
    const services = {
      repository: {
        get: () =>
          Promise.resolve({
            id: 'c1',
            engine: 'postgres',
            username: 'human',
            aiReadOnlyUsername: 'ai_reader',
          }),
      },
      connections: {
        open: (config: { id: string; username: string }) => {
          opened.push({ id: config.id, username: config.username })
          return Promise.resolve()
        },
        capabilities: () => ['sql'],
      },
    } as unknown as AppServices

    registerIpcRoutes(register, services)
    const result = await handlers.get('connection:open')!({ connectionId: 'c1' }, CONTEXT)

    expect(result).toMatchObject({ opened: true, aiAccount: 'ready' })
    expect(opened).toEqual([
      { id: 'c1', username: 'human' },
      { id: 'c1::ai', username: 'ai_reader' },
    ])
  })

  it('AI 파생 커넥션 open 실패는 로그만 남기고 사용자 연결은 성공이다', async () => {
    const handlers = new Map<string, (input: unknown, ctx: CallerContext) => Promise<unknown>>()
    const register = ((channel, handler) => {
      handlers.set(channel, handler as (input: unknown, ctx: CallerContext) => Promise<unknown>)
    }) as ContractRegister
    const warns: string[] = []
    const services = {
      repository: {
        get: () =>
          Promise.resolve({ id: 'c1', engine: 'postgres', aiReadOnlyUsername: 'ai_reader' }),
      },
      connections: {
        open: (config: { id: string }) =>
          config.id.endsWith('::ai')
            ? Promise.reject(new Error('auth failed for ai_reader'))
            : Promise.resolve(),
        capabilities: () => ['sql'],
      },
      logger: {
        warn: (event: string) => {
          warns.push(event)
        },
      },
    } as unknown as AppServices

    registerIpcRoutes(register, services)
    const result = await handlers.get('connection:open')!({ connectionId: 'c1' }, CONTEXT)

    expect(result).toMatchObject({ opened: true, aiAccount: 'failed' })
    expect(warns).toEqual(['connection.ai_readonly_open_failed'])
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
