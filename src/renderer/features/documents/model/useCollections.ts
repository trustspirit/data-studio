import { useCallback, useEffect, useRef, useState } from 'react'
import type { OperationGateway } from '../../../gateways/ports/OperationGateway'

export interface CollectionsState {
  readonly collections: readonly string[]
  readonly loading: boolean
  readonly error: string | null
  reload: () => void
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : 'unknown error'
}

/** 컬렉션 목록. connectionId가 바뀌거나 reload()가 호출되면 listCollections를 다시 부른다. */
export function useCollections(gateway: OperationGateway, connectionId: string): CollectionsState {
  const [collections, setCollections] = useState<readonly string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reloadTick, setReloadTick] = useState(0)
  const mounted = useRef(true)
  const latest = useRef(0)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  useEffect(() => {
    const token = latest.current + 1
    latest.current = token
    setLoading(true)
    setError(null)

    gateway
      .run({
        requestId: crypto.randomUUID(),
        connectionId,
        operation: { kind: 'document', op: 'listCollections' },
      })
      .then((outcome) => {
        if (token !== latest.current || !mounted.current) return
        if (outcome.ok && outcome.payload.kind === 'rows') {
          const names = outcome.payload.rows.rows.map((row) => {
            const cell = row[0]
            return cell !== undefined && cell.t === 'str' ? cell.v : ''
          })
          setCollections(names)
        } else if (!outcome.ok) {
          setError(outcome.reason)
        }
      })
      .catch((e: unknown) => {
        if (token === latest.current && mounted.current) setError(messageOf(e))
      })
      .finally(() => {
        if (token === latest.current && mounted.current) setLoading(false)
      })
  }, [gateway, connectionId, reloadTick])

  const reload = useCallback(() => setReloadTick((n) => n + 1), [])

  return { collections, loading, error, reload }
}
