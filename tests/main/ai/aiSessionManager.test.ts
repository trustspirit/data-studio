import { describe, expect, it, vi } from 'vitest'
import { AiSessionManager, type AiSessionManagerDeps } from '@main/ai/AiSessionManager'
import { LlmApiKeyMissingError } from '@main/ai/providers/anthropicAdapter'
import type { ChatTurnResult, LlmProvider } from '@main/core/ports/LlmProvider'
import type { AiStreamEvent } from '@shared/contracts/aiEvents'
import type { OperationExecutor } from '@main/core/execution/OperationExecutor'
import type { WriteProposalStore } from '@main/core/execution/WriteProposalStore'
import type { PiiRedactor } from '@main/ai/PiiRedactor'
import { fakeLlmProvider } from './fakeLlmProvider'

interface Pushed {
  sessionId: string
  event: AiStreamEvent
}

function makeDeps(provider: LlmProvider, over: Partial<AiSessionManagerDeps> = {}) {
  const pushed: Pushed[] = []
  let n = 0
  const deps: AiSessionManagerDeps = {
    providers: { anthropic: provider },
    executor: { run: vi.fn() } as unknown as OperationExecutor,
    connections: {
      list: () =>
        Promise.resolve([
          {
            id: 'c1',
            name: 'orders-db',
            engine: 'postgres' as const,
            host: 'localhost',
            port: 5432,
            database: 'orders',
            username: 'app',
            tlsMode: 'disable' as const,
            aiReadOnlyUsername: null,
            maskedColumnPatterns: [],
          },
        ]),
      get: () => Promise.resolve(null),
    },
    proposals: {} as WriteProposalStore,
    redactor: {} as PiiRedactor,
    randomId: () => `id-${(n += 1)}`,
    systemPrompt: 'SYSTEM',
    push: (sessionId, event) => pushed.push({ sessionId, event }),
    ...over,
  }
  return { deps, pushed }
}

/** send는 fire-and-forget이다 — 마이크로태스크 큐가 빌 때까지 기다린다. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('AiSessionManager', () => {
  it('없는 프로바이더로는 세션을 못 연다', async () => {
    const { deps } = makeDeps(fakeLlmProvider([]))
    const manager = new AiSessionManager(deps)

    await expect(manager.createSession('openai')).rejects.toThrow('provider not available')
  })

  it('세션을 열면 주입된 randomId로 sessionId를 만든다', async () => {
    const { deps } = makeDeps(fakeLlmProvider([]))
    const manager = new AiSessionManager(deps)

    const { sessionId } = await manager.createSession('anthropic')

    expect(sessionId).toBe('id-1')
  })

  it('스키마 컨텍스트(커넥션 목록)가 system 프리픽스로 들어간다', async () => {
    const provider = fakeLlmProvider([{ text: 'hi', toolUses: [], stopReason: 'end' }])
    const { deps } = makeDeps(provider)
    const manager = new AiSessionManager(deps)

    const { sessionId } = await manager.createSession('anthropic')
    manager.send(sessionId, 'hello')
    await settle()

    expect(provider.calls[0]?.system).toContain('SYSTEM')
    expect(provider.calls[0]?.system).toContain('orders-db')
    expect(provider.calls[0]?.system).toContain('postgres')
  })

  it('모르는 세션으로 send하면 accepted:false', () => {
    const { deps } = makeDeps(fakeLlmProvider([]))
    const manager = new AiSessionManager(deps)

    expect(manager.send('nope', 'hi')).toMatchObject({ accepted: false })
  })

  it('텍스트 턴을 text/done 이벤트로 push한다', async () => {
    const provider = fakeLlmProvider([{ text: 'hello!', toolUses: [], stopReason: 'end' }])
    const { deps, pushed } = makeDeps(provider)
    const manager = new AiSessionManager(deps)

    const { sessionId } = await manager.createSession('anthropic')
    expect(manager.send(sessionId, 'hi')).toEqual({ accepted: true })
    await settle()

    expect(pushed.map((p) => p.event)).toEqual([
      { type: 'text', delta: 'hello!' },
      { type: 'done' },
    ])
    expect(pushed[0]?.sessionId).toBe(sessionId)
  })

  it('tool_use 이벤트는 이름만 싣는다 (입력은 스트림에 새지 않음)', async () => {
    const provider = fakeLlmProvider([
      {
        text: '',
        toolUses: [{ id: 't1', name: 'run_read_query', input: { sql: 'SELECT secret FROM t' } }],
        stopReason: 'tool_use',
      },
      { text: 'done', toolUses: [], stopReason: 'end' },
    ])
    const { deps, pushed } = makeDeps(provider)
    const manager = new AiSessionManager(deps)

    const { sessionId } = await manager.createSession('anthropic')
    manager.send(sessionId, 'hi')
    await settle()

    const toolEvents = pushed.filter((p) => p.event.type === 'tool_use')
    expect(toolEvents).toEqual([
      { sessionId, event: { type: 'tool_use', name: 'run_read_query' } },
    ])
    // 어떤 이벤트에도 SQL 원문이 실리지 않는다.
    expect(JSON.stringify(pushed)).not.toContain('SELECT secret')
  })

  it('in-flight 중 두 번째 send는 accepted:false busy', async () => {
    let release: (turn: ChatTurnResult) => void = () => {}
    const blocking: LlmProvider = {
      id: 'anthropic',
      chat: () =>
        new Promise<ChatTurnResult>((resolve) => {
          release = resolve
        }),
    }
    const { deps } = makeDeps(blocking)
    const manager = new AiSessionManager(deps)

    const { sessionId } = await manager.createSession('anthropic')
    expect(manager.send(sessionId, 'one')).toEqual({ accepted: true })
    expect(manager.send(sessionId, 'two')).toMatchObject({ accepted: false, reason: 'session busy' })

    release({ text: '', toolUses: [], stopReason: 'end' })
    await settle()

    // 끝나면 다시 보낼 수 있다.
    expect(manager.send(sessionId, 'three')).toEqual({ accepted: true })
  })

  it('cancel은 다음 라운드에서 cancelled 에러 이벤트를 낸다', async () => {
    let release: (turn: ChatTurnResult) => void = () => {}
    const blocking: LlmProvider = {
      id: 'anthropic',
      chat: () =>
        new Promise<ChatTurnResult>((resolve) => {
          release = resolve
        }),
    }
    const { deps, pushed } = makeDeps(blocking)
    const manager = new AiSessionManager(deps)

    const { sessionId } = await manager.createSession('anthropic')
    manager.send(sessionId, 'hi')
    manager.cancel(sessionId)
    // tool_use로 끝나면 오케스트레이터가 다음 라운드로 가고, 거기서 abort를 본다.
    release({
      text: '',
      toolUses: [{ id: 't1', name: 'no_such_tool', input: {} }],
      stopReason: 'tool_use',
    })
    await settle()

    expect(pushed.at(-1)?.event).toEqual({ type: 'error', message: 'cancelled' })
    // 취소가 끝났으니 세션은 다시 유휴 상태다.
    expect(manager.send(sessionId, 'again')).toEqual({ accepted: true })
  })

  it('키 없음 예외는 그 메시지 그대로, 그 외 예외는 일반 문구로 push한다', async () => {
    const keyMissing: LlmProvider = {
      id: 'anthropic',
      chat: () => Promise.reject(new LlmApiKeyMissingError('anthropic')),
    }
    const { deps, pushed } = makeDeps(keyMissing)
    const manager = new AiSessionManager(deps)
    const { sessionId } = await manager.createSession('anthropic')
    manager.send(sessionId, 'hi')
    await settle()
    expect(pushed.at(-1)?.event).toEqual({
      type: 'error',
      message: 'missing api key for provider anthropic',
    })

    const leaky: LlmProvider = {
      id: 'anthropic',
      chat: () => Promise.reject(new Error('ECONNREFUSED 10.0.0.5:443 secret-host')),
    }
    const second = makeDeps(leaky)
    const manager2 = new AiSessionManager(second.deps)
    const { sessionId: s2 } = await manager2.createSession('anthropic')
    manager2.send(s2, 'hi')
    await settle()
    expect(second.pushed.at(-1)?.event).toEqual({ type: 'error', message: 'ai request failed' })
  })
})
