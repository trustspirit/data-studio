import { describe, it, expect } from 'vitest'
import { createIpcAiGateway } from '@renderer/gateways/ipc/ipcAiGateway'
import type { DataconBridge } from '@renderer/gateways/ipc/ipcInvoke'
import type { AiEventPayload, AiStreamEvent } from '@shared/contracts/aiEvents'

interface Invoked {
  channel: string
  input: unknown
}

function bridge(valueFor: (channel: string) => unknown) {
  const invoked: Invoked[] = []
  let pushListener: ((payload: unknown) => void) | null = null
  const b: DataconBridge = {
    invoke: (channel, input) => {
      invoked.push({ channel, input })
      return Promise.resolve({ ok: true, value: valueFor(channel) })
    },
    on: (_channel, listener) => {
      pushListener = listener
      return () => {
        pushListener = null
      }
    },
  }
  return { b, invoked, push: (p: AiEventPayload) => pushListener?.(p) }
}

describe('createIpcAiGateway', () => {
  it('각 메서드를 올바른 채널·입력으로 매핑한다', async () => {
    const { b, invoked } = bridge((ch) => {
      if (ch === 'ai:newSession') return { chatId: 'chat-1' }
      if (ch === 'ai:send') return { accepted: true }
      if (ch === 'ai:keyStatus') return { anthropic: true, openai: false }
      if (ch === 'ai:proposals') return []
      if (ch === 'ai:rejectProposal') return { rejected: true }
      return null
    })
    const gw = createIpcAiGateway(b)

    expect(await gw.newSession('anthropic')).toEqual({ chatId: 'chat-1' })
    expect(await gw.send('chat-1', 'hi')).toEqual({ accepted: true })
    await gw.cancel('chat-1')
    expect(await gw.keyStatus()).toEqual({ anthropic: true, openai: false })
    await gw.setKey('openai', 'sk-1')
    await gw.deleteKey('openai')
    expect(await gw.proposals('c1')).toEqual([])
    expect(await gw.rejectProposal('p1', 'c1')).toBe(true)

    expect(invoked).toEqual([
      { channel: 'ai:newSession', input: { provider: 'anthropic' } },
      { channel: 'ai:send', input: { chatId: 'chat-1', text: 'hi' } },
      { channel: 'ai:cancel', input: { chatId: 'chat-1' } },
      { channel: 'ai:keyStatus', input: undefined },
      { channel: 'ai:setKey', input: { provider: 'openai', value: 'sk-1' } },
      { channel: 'ai:deleteKey', input: { provider: 'openai' } },
      { channel: 'ai:proposals', input: { connectionId: 'c1' } },
      { channel: 'ai:rejectProposal', input: { proposalId: 'p1', connectionId: 'c1' } },
    ])
  })

  it('onEvent는 자기 chatId의 이벤트만 전달한다', () => {
    const { b, push } = bridge(() => null)
    const gw = createIpcAiGateway(b)
    const received: AiStreamEvent[] = []

    gw.onEvent('chat-1', (e) => received.push(e))
    push({ chatId: 'chat-1', event: { type: 'text', delta: 'a' } })
    push({ chatId: 'other', event: { type: 'text', delta: 'IGNORED' } })
    push({ chatId: 'chat-1', event: { type: 'done' } })

    expect(received).toEqual([
      { type: 'text', delta: 'a' },
      { type: 'done' },
    ])
  })

  it('onEvent 해제 후에는 이벤트가 오지 않는다', () => {
    const { b, push } = bridge(() => null)
    const gw = createIpcAiGateway(b)
    const received: AiStreamEvent[] = []

    const off = gw.onEvent('chat-1', (e) => received.push(e))
    off()
    push({ chatId: 'chat-1', event: { type: 'done' } })

    expect(received).toEqual([])
  })
})
