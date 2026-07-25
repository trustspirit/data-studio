// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useAiChat } from '@renderer/features/ai/model/useAiChat'
import type { AiGateway } from '@renderer/gateways/ports/AiGateway'
import type { AiStreamEvent } from '@shared/contracts/aiEvents'

/** onEvent 리스너를 붙잡아 테스트가 스트림 이벤트를 밀 수 있게 한다.
 * 단언은 반환된 mock 상수로 한다(unbound-method 회피). */
function fakeGateway(over: Partial<AiGateway> = {}) {
  let listener: ((e: AiStreamEvent) => void) | null = null
  const unsub = vi.fn()
  const newSession = vi.fn().mockResolvedValue({ chatId: 'chat-1' })
  const send = vi.fn().mockResolvedValue({ accepted: true })
  const cancel = vi.fn().mockResolvedValue(undefined)
  const gw: AiGateway = {
    newSession,
    send,
    cancel,
    keyStatus: vi.fn().mockResolvedValue({ anthropic: true, openai: true }),
    setKey: vi.fn().mockResolvedValue(undefined),
    deleteKey: vi.fn().mockResolvedValue(undefined),
    proposals: vi.fn().mockResolvedValue([]),
    rejectProposal: vi.fn().mockResolvedValue(true),
    onEvent: (_id: string, l: (e: AiStreamEvent) => void) => {
      listener = l
      return unsub
    },
    ...over,
  }
  return { gw, newSession, send, cancel, emit: (e: AiStreamEvent) => listener?.(e), unsub }
}

describe('useAiChat', () => {
  it('첫 send에서 세션을 열고 구독한 뒤 메시지를 보낸다', async () => {
    const { gw, newSession, send } = fakeGateway()
    const { result } = renderHook(() => useAiChat(gw))

    await act(async () => {
      await result.current.send('show tables')
    })

    expect(newSession).toHaveBeenCalledWith('anthropic')
    expect(send).toHaveBeenCalledWith('chat-1', 'show tables')
    expect(result.current.items).toEqual([{ role: 'user', text: 'show tables', tools: [] }])
    expect(result.current.streaming).toBe(true)
  })

  it('두 번째 send는 세션을 재사용한다', async () => {
    const { gw, newSession, send, emit } = fakeGateway()
    const { result } = renderHook(() => useAiChat(gw))

    await act(async () => {
      await result.current.send('one')
    })
    act(() => {
      emit({ type: 'done' })
    })
    await act(async () => {
      await result.current.send('two')
    })

    expect(newSession).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('text 델타가 assistant 항목으로 누적되고 done이 스트리밍을 끝낸다', async () => {
    const { gw, emit } = fakeGateway()
    const { result } = renderHook(() => useAiChat(gw))

    await act(async () => {
      await result.current.send('hi')
    })
    act(() => {
      emit({ type: 'text', delta: 'hel' })
      emit({ type: 'text', delta: 'lo' })
      emit({ type: 'done' })
    })

    await waitFor(() => expect(result.current.streaming).toBe(false))
    expect(result.current.items.at(-1)).toEqual({ role: 'assistant', text: 'hello', tools: [] })
  })

  it('tool_use가 배지로 쌓이고 propose_write는 proposalSignal을 올린다', async () => {
    const { gw, emit } = fakeGateway()
    const { result } = renderHook(() => useAiChat(gw))

    await act(async () => {
      await result.current.send('do it')
    })
    const before = result.current.proposalSignal
    act(() => {
      emit({ type: 'tool_use', name: 'get_schema' })
      emit({ type: 'tool_use', name: 'propose_write' })
      emit({ type: 'text', delta: 'proposed' })
    })

    await waitFor(() =>
      expect(result.current.items.at(-1)).toMatchObject({
        role: 'assistant',
        text: 'proposed',
        tools: ['get_schema', 'propose_write'],
      }),
    )
    expect(result.current.proposalSignal).toBeGreaterThan(before)
  })

  it('error 이벤트가 오류 상태로 남고 스트리밍을 끝낸다', async () => {
    const { gw, emit } = fakeGateway()
    const { result } = renderHook(() => useAiChat(gw))

    await act(async () => {
      await result.current.send('hi')
    })
    act(() => {
      emit({ type: 'error', message: 'missing api key for provider anthropic' })
    })

    await waitFor(() => expect(result.current.streaming).toBe(false))
    expect(result.current.error).toContain('missing api key')
  })

  it('send가 거부되면(reason) 즉시 오류가 된다', async () => {
    const { gw } = fakeGateway({
      send: vi.fn().mockResolvedValue({ accepted: false, reason: 'session busy' }),
    })
    const { result } = renderHook(() => useAiChat(gw))

    await act(async () => {
      await result.current.send('hi')
    })

    expect(result.current.error).toBe('session busy')
    expect(result.current.streaming).toBe(false)
  })

  it('provider를 바꾸면 대화가 초기화되고 다음 send에서 새 세션을 연다', async () => {
    const { gw, newSession, emit } = fakeGateway()
    const { result } = renderHook(() => useAiChat(gw))

    await act(async () => {
      await result.current.send('one')
    })
    act(() => {
      emit({ type: 'done' })
    })
    act(() => {
      result.current.setProvider('openai')
    })

    expect(result.current.items).toEqual([])

    await act(async () => {
      await result.current.send('two')
    })
    expect(newSession).toHaveBeenCalledTimes(2)
    expect(newSession).toHaveBeenLastCalledWith('openai')
  })

  it('cancel은 열린 세션의 chatId로 나간다', async () => {
    const { gw, cancel } = fakeGateway()
    const { result } = renderHook(() => useAiChat(gw))

    await act(async () => {
      await result.current.send('hi')
    })
    act(() => {
      result.current.cancel()
    })

    expect(cancel).toHaveBeenCalledWith('chat-1')
  })

  it('언마운트 시 이벤트 구독을 해제한다', async () => {
    const { gw, unsub } = fakeGateway()
    const { result, unmount } = renderHook(() => useAiChat(gw))

    await act(async () => {
      await result.current.send('hi')
    })
    unmount()

    expect(unsub).toHaveBeenCalled()
  })
})
