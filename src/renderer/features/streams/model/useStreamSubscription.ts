import { useCallback, useEffect, useRef, useState } from 'react'
import type { ColumnDescriptor } from '../../../../shared/types/resultSet'
import type { WireValue } from '../../../../shared/types/wire'
import type { OperationGateway } from '../../../gateways/ports/OperationGateway'

/** 라이브 tail이 화면에 유지하는 최대 행 수(오래된 것부터 버린다). */
const MAX_LIVE_ROWS = 2000

export interface StreamSubscriptionState {
  readonly columns: readonly ColumnDescriptor[]
  readonly rows: readonly (readonly WireValue[])[]
  readonly dropped: number
  readonly running: boolean
  readonly error: string | null
  start: (topic: string, from: 'latest' | 'earliest') => void
  stop: () => Promise<void>
  clear: () => void
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : 'unknown error'
}

/**
 * 라이브 스트림 구독. start(topic, from)이 subscribe op으로 subscriptionId를 받고
 * push 배치를 onStreamMessage로 구독해 행을 누적한다. stop이 unsubscribe op을 보내고
 * 리스너를 뗀다. 언마운트·connectionId 변경 시 자동 stop.
 */
export function useStreamSubscription(gateway: OperationGateway, connectionId: string): StreamSubscriptionState {
  const [columns, setColumns] = useState<readonly ColumnDescriptor[]>([])
  const [rows, setRows] = useState<readonly (readonly WireValue[])[]>([])
  const [dropped, setDropped] = useState(0)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const subId = useRef<string | null>(null)
  const off = useRef<(() => void) | null>(null)
  const mounted = useRef(true)

  const teardown = useCallback(async () => {
    off.current?.()
    off.current = null
    const id = subId.current
    subId.current = null
    setRunning(false)
    if (id !== null) {
      await gateway.run({ requestId: crypto.randomUUID(), connectionId, operation: { kind: 'stream', op: 'unsubscribe', subscriptionId: id } })
    }
  }, [gateway, connectionId])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      off.current?.()
      off.current = null
      const id = subId.current
      subId.current = null
      if (id !== null) {
        void gateway.run({ requestId: crypto.randomUUID(), connectionId, operation: { kind: 'stream', op: 'unsubscribe', subscriptionId: id } })
      }
    }
  }, [gateway, connectionId])

  const start = useCallback(
    (topic: string, from: 'latest' | 'earliest') => {
      void (async () => {
        await teardown()
        setRows([]); setColumns([]); setDropped(0); setError(null)
        const outcome = await gateway.run({
          requestId: crypto.randomUUID(), connectionId,
          operation: { kind: 'stream', op: 'subscribe', topic, from },
        })
        if (!mounted.current) return
        if (!outcome.ok) { setError(outcome.reason); return }
        if (outcome.payload.kind !== 'streamAck' || outcome.payload.subscriptionId === null) {
          setError('subscribe did not return a subscription'); return
        }
        const id = outcome.payload.subscriptionId
        subId.current = id
        setRunning(true)
        off.current = gateway.onStreamMessage(id, (batch) => {
          if (!mounted.current) return
          if (batch.columns.length > 0) setColumns(batch.columns)
          if (batch.droppedSince > 0) setDropped((d) => d + batch.droppedSince)
          setRows((prev) => {
            const next = [...prev, ...batch.rows]
            return next.length > MAX_LIVE_ROWS ? next.slice(next.length - MAX_LIVE_ROWS) : next
          })
        })
      })().catch((e: unknown) => { if (mounted.current) setError(messageOf(e)) })
    },
    [gateway, connectionId, teardown],
  )

  const stop = useCallback(() => teardown(), [teardown])
  const clear = useCallback(() => { setRows([]); setDropped(0) }, [])

  return { columns, rows, dropped, running, error, start, stop, clear }
}
