import { useCallback, useEffect, useRef, useState } from 'react'
import type { AiGateway, AiKeyStatus, AiProviderId } from '../../../gateways/ports/AiGateway'

export interface AiKeysState {
  /** null이면 아직 조회 전. */
  readonly status: AiKeyStatus | null
  readonly error: string | null
  saveKey: (provider: AiProviderId, value: string) => Promise<void>
  removeKey: (provider: AiProviderId) => Promise<void>
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : 'unknown error'
}

/** LLM API 키의 존재 여부와 저장/삭제. 키 값 자체는 renderer에 오지 않는다. */
export function useAiKeys(gateway: AiGateway): AiKeysState {
  const [status, setStatus] = useState<AiKeyStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const mounted = useRef(true)

  const refresh = useCallback(async () => {
    try {
      const s = await gateway.keyStatus()
      if (mounted.current) setStatus(s)
    } catch (e) {
      if (mounted.current) setError(messageOf(e))
    }
  }, [gateway])

  useEffect(() => {
    mounted.current = true
    void refresh()
    return () => {
      mounted.current = false
    }
  }, [refresh])

  const saveKey = useCallback(
    async (provider: AiProviderId, value: string) => {
      if (value.trim() === '') return
      setError(null)
      try {
        await gateway.setKey(provider, value.trim())
      } catch (e) {
        if (mounted.current) setError(messageOf(e))
      }
      await refresh()
    },
    [gateway, refresh],
  )

  const removeKey = useCallback(
    async (provider: AiProviderId) => {
      setError(null)
      try {
        await gateway.deleteKey(provider)
      } catch (e) {
        if (mounted.current) setError(messageOf(e))
      }
      await refresh()
    },
    [gateway, refresh],
  )

  return { status, error, saveKey, removeKey }
}
