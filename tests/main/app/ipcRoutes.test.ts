import { describe, expect, it } from 'vitest'
import { registerIpcRoutes, type ContractRegister } from '@main/app/ipcRoutes'
import type { AppServices } from '@main/app/compositionRoot'
import type { ContractChannel } from '@shared/contracts/ipcContract'
import type { CallerContext } from '@main/ipc/CallerContext'
import type { Actor } from '@main/core/execution/Actor'
import type { OperationRequest } from '@shared/types/operation'

const CONTEXT: CallerContext = { source: 'renderer-ui' }

interface RunCall {
  request: OperationRequest
  actor: Actor
}

function createHarness() {
  const handlers = new Map<string, (input: unknown, ctx: CallerContext) => Promise<unknown>>()
  const runCalls: RunCall[] = []
  const calls = {
    save: [] as unknown[],
    delete: [] as string[],
    cancel: [] as string[],
    recent: [] as number[],
    listCalled: 0,
    statusCalled: 0,
    secretSet: [] as { ref: unknown; value: string }[],
    secretDelete: [] as unknown[],
    secretHasReturns: null as string | null,
  }

  const register = ((channel, handler) => {
    handlers.set(channel, handler as (input: unknown, ctx: CallerContext) => Promise<unknown>)
  }) as ContractRegister

  const services = {
    repository: {
      list: () => {
        calls.listCalled += 1
        return Promise.resolve([])
      },
      get: () => Promise.resolve(null),
      save: (config: unknown) => {
        calls.save.push(config)
        return Promise.resolve()
      },
      delete: (id: string) => {
        calls.delete.push(id)
        return Promise.resolve()
      },
    },
    secrets: {
      isPersistent: () => {
        calls.statusCalled += 1
        return true
      },
      set: (ref: unknown, value: string) => {
        calls.secretSet.push({ ref, value })
        return Promise.resolve()
      },
      get: () => Promise.resolve(calls.secretHasReturns),
      delete: (ref: unknown) => {
        calls.secretDelete.push(ref)
        return Promise.resolve()
      },
    },
    log: {
      record: () => undefined,
      recent: (limit: number) => {
        calls.recent.push(limit)
        return []
      },
      droppedCount: () => 0,
    },
    executor: {
      run: (request: OperationRequest, actor: Actor) => {
        runCalls.push({ request, actor })
        return Promise.resolve({ ok: true as const, payload: { kind: 'rows' as const } })
      },
      cancel: (requestId: string) => {
        calls.cancel.push(requestId)
      },
    },
  } as unknown as AppServices

  registerIpcRoutes(register, services)

  return {
    calls,
    runCalls,
    invoke: (channel: ContractChannel, input: unknown) => {
      const handler = handlers.get(channel)
      if (handler === undefined) throw new Error(`no handler for ${channel}`)
      return handler(input, CONTEXT)
    },
  }
}

describe('registerIpcRoutes', () => {
  it('connection:save를 저장소로 보낸다', async () => {
    const h = createHarness()
    const config = { id: 'c1', name: 'x' }
    await h.invoke('connection:save', config)

    expect(h.calls.save).toEqual([config])
  })

  it('connection:delete를 저장소로 보낸다', async () => {
    const h = createHarness()
    await h.invoke('connection:delete', { id: 'c1' })

    expect(h.calls.delete).toEqual(['c1'])
  })

  it('secrets:status를 secret store로 보낸다', async () => {
    const h = createHarness()
    await h.invoke('secrets:status', undefined)

    expect(h.calls.statusCalled).toBe(1)
  })

  it('operation:cancel을 executor로 보낸다', async () => {
    const h = createHarness()
    await h.invoke('operation:cancel', { requestId: 'r1' })

    expect(h.calls.cancel).toEqual(['r1'])
  })

  it('audit:recent를 log로 보낸다', async () => {
    const h = createHarness()
    await h.invoke('audit:recent', { limit: 20 })

    expect(h.calls.recent).toEqual([20])
  })

  it('승인 토큰 없는 operation:run은 grant 없는 사용자 actor를 만든다', async () => {
    const h = createHarness()
    await h.invoke('operation:run', {
      requestId: 'r1',
      connectionId: 'c1',
      operation: { kind: 'sql', sql: 'SELECT 1' },
    })

    expect(h.runCalls[0]?.actor).toEqual({ type: 'user', grant: null })
  })

  it('승인 토큰이 있으면 grant를 실은 사용자 actor를 만든다', async () => {
    const h = createHarness()
    await h.invoke('operation:run', {
      requestId: 'r1',
      connectionId: 'c1',
      operation: { kind: 'sql', sql: 'SELECT 1' },
      proposalId: 'prop-9',
    })

    expect(h.runCalls[0]?.actor).toEqual({ type: 'user', grant: { proposalId: 'prop-9' } })
  })

  it('renderer가 어떤 형태로도 ai actor를 만들 수 없다', async () => {
    // 스키마가 이미 strip하지만, 라우트가 입력의 actor를 읽지 않는다는 것도 확인한다.
    const h = createHarness()
    await h.invoke('operation:run', {
      requestId: 'r1',
      connectionId: 'c1',
      operation: { kind: 'sql', sql: 'SELECT 1' },
      // 계약 스키마는 이 필드를 strip한다 — 여기서는 라우트가 input에서 actor를
      // 읽지 않음을 확인하려고 넣어 본다.
      actor: { type: 'ai', sessionId: 'evil' },
    })

    expect(h.runCalls[0]?.actor.type).toBe('user')
  })

  it('요청을 그대로 executor로 전달한다', async () => {
    const h = createHarness()
    await h.invoke('operation:run', {
      requestId: 'r1',
      connectionId: 'c1',
      operation: { kind: 'sql', sql: 'SELECT 1' },
      page: { cursor: null, maxRows: 10, maxBytes: 100 },
    })

    expect(h.runCalls[0]?.request).toMatchObject({
      requestId: 'r1',
      connectionId: 'c1',
      page: { maxRows: 10 },
    })
  })

  it('secrets:set은 db-password ref와 value로 store.set을 부른다', async () => {
    const h = createHarness()
    await h.invoke('secrets:set', { connectionId: 'c1', value: 'pw' })
    // 잘못된 kind나 ownerId면 드라이버가 다른 키로 저장해 연결 시 비밀을 못 찾는다.
    expect(h.calls.secretSet).toEqual([
      { ref: { kind: 'db-password', ownerId: 'c1' }, value: 'pw' },
    ])
  })

  it('secrets:has는 존재 여부 boolean만 반환한다 (값 아님)', async () => {
    const h = createHarness()
    h.calls.secretHasReturns = 'super-secret'
    const present = await h.invoke('secrets:has', { connectionId: 'c1' })
    // 값을 새어 보내면 이 단언이 깨진다 — 정확히 {exists:true}여야 한다.
    expect(present).toEqual({ exists: true })

    h.calls.secretHasReturns = null
    const absent = await h.invoke('secrets:has', { connectionId: 'c1' })
    expect(absent).toEqual({ exists: false })
  })

  it('connection:delete는 config와 db-password 비밀을 함께 지운다', async () => {
    const h = createHarness()
    await h.invoke('connection:delete', { id: 'c1' })
    expect(h.calls.delete).toEqual(['c1'])
    // 비밀 삭제를 빠뜨리면 고아 비밀이 남는다.
    expect(h.calls.secretDelete).toEqual([{ kind: 'db-password', ownerId: 'c1' }])
  })
})
