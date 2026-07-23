import { useCallback, useEffect, useRef, useState } from 'react'
import type { OperationGateway } from '../../../gateways/ports/OperationGateway'

const MAX_BYTES = 8 * 1024 * 1024

export interface KeyEntry {
  readonly type: string
  readonly ttl: number
  readonly value: string // 정규화 JSON 문자열
}

export interface KeyValueState {
  readonly entry: KeyEntry | null
  readonly loading: boolean
  readonly error: string | null
  load: (key: string) => void
  clear: () => void
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : 'unknown error'
}

/** 선택된 키의 값(get). load(key)로 명시 실행, clear()로 비운다. */
export function useKeyValue(gateway: OperationGateway, connectionId: string): KeyValueState {
  const [entry, setEntry] = useState<KeyEntry | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mounted = useRef(true)
  const latest = useRef(0)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  useEffect(() => {
    latest.current += 1
    setEntry(null); setError(null); setLoading(false)
  }, [connectionId])

  const load = useCallback(
    (key: string) => {
      const token = latest.current + 1
      latest.current = token
      setLoading(true); setError(null)
      gateway
        .run({
          requestId: crypto.randomUUID(),
          connectionId,
          operation: { kind: 'keyvalue', op: 'get', key },
          page: { cursor: null, maxRows: 1, maxBytes: MAX_BYTES },
        })
        .then((outcome) => {
          if (token !== latest.current || !mounted.current) return
          if (outcome.ok && outcome.payload.kind === 'rows') {
            const row = outcome.payload.rows.rows[0]
            if (row === undefined) { setEntry(null); return }
            setEntry({
              type: row[0]?.t === 'str' ? row[0].v : '',
              ttl: row[1]?.t === 'int' ? row[1].v : -2,
              value: row[2]?.t === 'json' ? row[2].v : '',
            })
          } else if (!outcome.ok) setError(outcome.reason)
        })
        .catch((e: unknown) => {
          if (token === latest.current && mounted.current) setError(messageOf(e))
        })
        .finally(() => {
          if (token === latest.current && mounted.current) setLoading(false)
        })
    },
    [gateway, connectionId],
  )

  const clear = useCallback(() => {
    latest.current += 1
    setEntry(null); setError(null); setLoading(false)
  }, [])

  return { entry, loading, error, load, clear }
}
