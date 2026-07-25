import { useCallback, useEffect, useRef, useState } from 'react'
import type { OperationGateway } from '../../../gateways/ports/OperationGateway'
import { failureText } from '../../../shared/lib'

export interface StreamTopicsState {
  readonly topics: readonly string[]
  readonly loading: boolean
  readonly error: string | null
  reload: () => void
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : 'unknown error'
}

/** 토픽 목록. connectionId 변경/reload 시 listTopics를 다시 부른다. */
export function useStreamTopics(gateway: OperationGateway, connectionId: string): StreamTopicsState {
  const [topics, setTopics] = useState<readonly string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const mounted = useRef(true)
  const latest = useRef(0)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  useEffect(() => {
    const token = latest.current + 1
    latest.current = token
    setLoading(true); setError(null)
    gateway
      .run({ requestId: crypto.randomUUID(), connectionId, operation: { kind: 'stream', op: 'listTopics' } })
      .then((outcome) => {
        if (token !== latest.current || !mounted.current) return
        if (outcome.ok && outcome.payload.kind === 'rows') {
          setTopics(outcome.payload.rows.rows.map((row) => (row[0]?.t === 'str' ? row[0].v : '')))
        } else if (!outcome.ok) setError(failureText(outcome))
      })
      .catch((e: unknown) => { if (token === latest.current && mounted.current) setError(messageOf(e)) })
      .finally(() => { if (token === latest.current && mounted.current) setLoading(false) })
  }, [gateway, connectionId, tick])

  const reload = useCallback(() => setTick((n) => n + 1), [])
  return { topics, loading, error, reload }
}
