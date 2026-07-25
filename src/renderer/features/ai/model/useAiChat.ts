import { useCallback, useEffect, useRef, useState } from 'react'
import type { AiGateway, AiProviderId } from '../../../gateways/ports/AiGateway'

/**
 * 대화록 항목. assistant 항목은 스트리밍 동안 제자리에서 자라나며,
 * tool 사용은 그 턴에 이름만 배지로 쌓인다.
 */
export interface ChatItem {
  readonly role: 'user' | 'assistant'
  readonly text: string
  readonly tools: readonly string[]
}

export interface AiChatState {
  readonly items: readonly ChatItem[]
  readonly streaming: boolean
  readonly error: string | null
  readonly provider: AiProviderId
  setProvider: (p: AiProviderId) => void
  send: (text: string) => Promise<void>
  cancel: () => void
  /** propose_write tool 사용이 관측될 때마다 증가 — 승인 UI의 새로고침 신호. */
  readonly proposalSignal: number
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : 'unknown error'
}

/**
 * AI 채팅 훅. 세션은 첫 send에서 lazily 연다(그 시점의 provider로 고정).
 * provider를 바꾸면 대화가 초기화된다 — 세션의 대화 이력은 main의
 * 오케스트레이터에 있으므로 provider만 바꿔치기할 수 없다.
 */
export function useAiChat(gateway: AiGateway, initialProvider: AiProviderId = 'anthropic'): AiChatState {
  const [items, setItems] = useState<readonly ChatItem[]>([])
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [provider, setProviderState] = useState<AiProviderId>(initialProvider)
  const [proposalSignal, setProposalSignal] = useState(0)
  const chatId = useRef<string | null>(null)
  const off = useRef<(() => void) | null>(null)
  const mounted = useRef(true)
  const inFlight = useRef(false)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      off.current?.()
      off.current = null
    }
  }, [])

  const appendToAssistant = useCallback((delta: string) => {
    setItems((prev) => {
      const last = prev.at(-1)
      if (last === undefined || last.role !== 'assistant') {
        return [...prev, { role: 'assistant', text: delta, tools: [] }]
      }
      return [...prev.slice(0, -1), { ...last, text: last.text + delta }]
    })
  }, [])

  const noteToolUse = useCallback((name: string) => {
    setItems((prev) => {
      const last = prev.at(-1)
      if (last === undefined || last.role !== 'assistant') {
        return [...prev, { role: 'assistant', text: '', tools: [name] }]
      }
      return [...prev.slice(0, -1), { ...last, tools: [...last.tools, name] }]
    })
    if (name === 'propose_write') setProposalSignal((n) => n + 1)
  }, [])

  const subscribe = useCallback(
    (id: string) => {
      off.current?.()
      off.current = gateway.onEvent(id, (event) => {
        if (!mounted.current) return
        if (event.type === 'text') {
          appendToAssistant(event.delta)
        } else if (event.type === 'tool_use') {
          noteToolUse(event.name)
        } else if (event.type === 'done') {
          setStreaming(false)
          inFlight.current = false
          // 승인 대기 제안이 done 시점에 확정되어 있으므로 한 번 더 신호.
          setProposalSignal((n) => n + 1)
        } else if (event.type === 'error') {
          setStreaming(false)
          inFlight.current = false
          setError(event.message)
        }
        // thinking 델타는 표시하지 않는다 — 요약 텍스트가 본문으로 온다.
      })
    },
    [gateway, appendToAssistant, noteToolUse],
  )

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim()
      if (trimmed === '' || inFlight.current) return
      inFlight.current = true
      setError(null)
      setItems((prev) => [...prev, { role: 'user', text: trimmed, tools: [] }])
      setStreaming(true)
      try {
        if (chatId.current === null) {
          const { chatId: id } = await gateway.newSession(provider)
          if (!mounted.current) return
          chatId.current = id
          subscribe(id)
        }
        const outcome = await gateway.send(chatId.current, trimmed)
        if (!outcome.accepted) {
          setStreaming(false)
          inFlight.current = false
          setError(outcome.reason)
        }
      } catch (e) {
        setStreaming(false)
        inFlight.current = false
        setError(messageOf(e))
      }
    },
    [gateway, provider, subscribe],
  )

  const cancel = useCallback(() => {
    const id = chatId.current
    if (id !== null) void gateway.cancel(id)
  }, [gateway])

  const setProvider = useCallback((p: AiProviderId) => {
    // 세션은 provider에 묶여 있다 — 바꾸면 새 대화로 시작한다.
    setProviderState(p)
    chatId.current = null
    off.current?.()
    off.current = null
    setItems([])
    setError(null)
    setStreaming(false)
    inFlight.current = false
  }, [])

  return { items, streaming, error, provider, setProvider, send, cancel, proposalSignal }
}
