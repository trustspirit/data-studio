import { useCallback, useEffect, useRef, useState } from 'react'
import type { ResultSet } from '../../../../shared/types/resultSet'
import type { OperationGateway } from '../../../gateways/ports/OperationGateway'

const MAX_ROWS = 1000
const MAX_BYTES = 8 * 1024 * 1024

export interface KeyRow {
  readonly key: string
  readonly type: string
  readonly ttl: number
}

export interface KeysState {
  readonly keys: readonly KeyRow[]
  readonly hasMore: boolean
  readonly loading: boolean
  readonly error: string | null
  /** match 패턴으로 scan을 처음부터 실행한다(직전 결과는 버린다). */
  run: (match: string) => void
  loadMore: () => Promise<void>
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : 'unknown error'
}

function toKeyRows(rs: ResultSet): KeyRow[] {
  return rs.rows.map((row) => ({
    key: row[0]?.t === 'str' ? row[0].v : '',
    type: row[1]?.t === 'str' ? row[1].v : '',
    ttl: row[2]?.t === 'int' ? row[2].v : -2,
  }))
}

/**
 * Redis 키 목록(scan). Documents 뷰의 useDocumentsData와 같은 명시적 트리거 방식이다
 * — match를 입력하고 Run을 눌러야 실행된다. loadMore는 SCAN 커서로 이어읽는다.
 */
export function useKeys(gateway: OperationGateway, connectionId: string): KeysState {
  const [keys, setKeys] = useState<readonly KeyRow[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mounted = useRef(true)
  const latest = useRef(0)
  const inFlight = useRef(false)
  const lastMatch = useRef<string | null>(null)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  // 연결이 바뀌면 이전 연결 결과가 남지 않도록 초기화한다.
  useEffect(() => {
    latest.current += 1
    inFlight.current = false
    lastMatch.current = null
    setKeys([]); setCursor(null); setHasMore(false); setError(null); setLoading(false)
  }, [connectionId])

  const runScan = useCallback(
    async (match: string, pageCursor: string | null, append: boolean, token: number) => {
      if (inFlight.current) return
      inFlight.current = true
      setLoading(true)
      if (!append) setError(null)
      try {
        const outcome = await gateway.run({
          requestId: crypto.randomUUID(),
          connectionId,
          operation: match === '' ? { kind: 'keyvalue', op: 'scan' } : { kind: 'keyvalue', op: 'scan', match },
          page: { cursor: pageCursor, maxRows: MAX_ROWS, maxBytes: MAX_BYTES },
        })
        if (token !== latest.current || !mounted.current) return
        if (outcome.ok && outcome.payload.kind === 'rows') {
          const rs = outcome.payload.rows
          setKeys((prev) => (append ? [...prev, ...toKeyRows(rs)] : toKeyRows(rs)))
          setCursor(rs.page.cursor)
          setHasMore(rs.page.hasMore)
        } else if (!outcome.ok) setError(outcome.reason)
      } catch (e) {
        if (token === latest.current && mounted.current) setError(messageOf(e))
      } finally {
        if (token === latest.current) { setLoading(false); inFlight.current = false }
      }
    },
    [gateway, connectionId],
  )

  const run = useCallback(
    (match: string) => {
      const token = latest.current + 1
      latest.current = token
      inFlight.current = false
      lastMatch.current = match
      setKeys([]); setCursor(null); setHasMore(false)
      void runScan(match, null, false, token)
    },
    [runScan],
  )

  const loadMore = useCallback(async () => {
    if (!hasMore || cursor === null || lastMatch.current === null) return
    await runScan(lastMatch.current, cursor, true, latest.current)
  }, [hasMore, cursor, runScan])

  return { keys, hasMore, loading, error, run, loadMore }
}
