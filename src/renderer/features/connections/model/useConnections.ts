import { useCallback, useEffect, useState } from 'react'
import type { ConnectionConfig } from '@shared/types/connection'
import type { ConnectionGateway } from '../../../gateways/ports/ConnectionGateway'

export interface ConnectionsState {
  readonly connections: readonly ConnectionConfig[]
  readonly selectedId: string | null
  readonly error: string | null
  select: (id: string) => void
  clearSelection: () => void
  save: (config: ConnectionConfig) => Promise<void>
  remove: (id: string) => Promise<void>
  reload: () => Promise<void>
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : 'unknown error'
}

export function useConnections(gateway: ConnectionGateway): ConnectionsState {
  const [connections, setConnections] = useState<readonly ConnectionConfig[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    try {
      setConnections(await gateway.list())
      setError(null)
    } catch (e) {
      setError(messageOf(e))
    }
  }, [gateway])

  useEffect(() => {
    void reload()
  }, [reload])

  const save = useCallback(
    async (config: ConnectionConfig) => {
      try {
        await gateway.save(config)
        setError(null)
        await reload()
        setSelectedId(config.id)
      } catch (e) {
        setError(messageOf(e))
      }
    },
    [gateway, reload],
  )

  const remove = useCallback(
    async (id: string) => {
      try {
        await gateway.delete(id)
        setError(null)
        await reload()
        setSelectedId((cur) => (cur === id ? null : cur))
      } catch (e) {
        setError(messageOf(e))
      }
    },
    [gateway, reload],
  )

  const select = useCallback((id: string) => setSelectedId(id), [])
  const clearSelection = useCallback(() => setSelectedId(null), [])

  return { connections, selectedId, error, select, clearSelection, save, remove, reload }
}
