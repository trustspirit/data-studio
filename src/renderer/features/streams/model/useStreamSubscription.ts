import { useCallback, useEffect, useRef, useState } from 'react'
import type { ColumnDescriptor } from '../../../../shared/types/resultSet'
import type { WireValue } from '../../../../shared/types/wire'
import type { OperationGateway } from '../../../gateways/ports/OperationGateway'
import { failureText } from '../../../shared/lib'

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
  /** 재진입(reentrant) start() 가드용 세대 토큰. stop/teardown/unmount·connectionId 변경 시 증가시켜
   * 그 사이 진행 중이던 start()의 continuation이 자신이 대체됐음을 감지하고 고아 구독을 정리하게 한다. */
  const startToken = useRef(0)

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
      startToken.current += 1
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
      const token = (startToken.current += 1)
      void (async () => {
        await teardown()
        if (token !== startToken.current) return // teardown 도중 다른 start/stop/unmount에 의해 대체됨
        setRows([]); setColumns([]); setDropped(0); setError(null)
        const outcome = await gateway.run({
          requestId: crypto.randomUUID(), connectionId,
          operation: { kind: 'stream', op: 'subscribe', topic, from },
        })
        if (!outcome.ok) {
          if (token === startToken.current && mounted.current) setError(failureText(outcome))
          return
        }
        if (outcome.payload.kind !== 'streamAck' || outcome.payload.subscriptionId === null) {
          if (token === startToken.current && mounted.current) setError('subscribe did not return a subscription')
          return
        }
        const id = outcome.payload.subscriptionId
        if (token !== startToken.current || !mounted.current) {
          // subscribe가 진행 중인 사이 대체되거나(reentrant start) 언마운트됨: 서버 구독이 고아가 되지 않도록 즉시 해제.
          void gateway.run({ requestId: crypto.randomUUID(), connectionId, operation: { kind: 'stream', op: 'unsubscribe', subscriptionId: id } })
          return
        }
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
      })().catch((e: unknown) => { if (token === startToken.current && mounted.current) setError(messageOf(e)) })
    },
    [gateway, connectionId, teardown],
  )

  const stop = useCallback(() => {
    startToken.current += 1
    return teardown()
  }, [teardown])
  const clear = useCallback(() => { setRows([]); setDropped(0) }, [])

  return { columns, rows, dropped, running, error, start, stop, clear }
}
