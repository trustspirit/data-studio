import { useCallback, useEffect, useRef, useState } from 'react'
import type { AuditEntry, OperationGateway } from '../../../gateways/ports/OperationGateway'

export interface AuditLogState {
  readonly entries: readonly AuditEntry[]
  readonly loading: boolean
  readonly error: string | null
  refresh: () => void
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : 'unknown error'
}

export function useAuditLog(gateway: OperationGateway, limit = 200): AuditLogState {
  const [entries, setEntries] = useState<readonly AuditEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mounted = useRef(true)
  const latest = useRef(0)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const refresh = useCallback(() => {
    const token = latest.current + 1
    latest.current = token
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        const result = await gateway.recentAudit(limit)
        if (!mounted.current || token !== latest.current) return
        setEntries(result)
        setLoading(false)
      } catch (e) {
        if (!mounted.current || token !== latest.current) return
        setError(messageOf(e))
        setLoading(false)
      }
    })()
  }, [gateway, limit])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { entries, loading, error, refresh }
}
