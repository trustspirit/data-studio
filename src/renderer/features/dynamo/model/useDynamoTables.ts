import { useCallback, useEffect, useRef, useState } from 'react'
import type { ResultSet } from '../../../../shared/types/resultSet'
import type { OperationGateway } from '../../../gateways/ports/OperationGateway'
import { failureText } from '../../../shared/lib'

const MAX_ROWS = 1000
const MAX_BYTES = 8 * 1024 * 1024

export interface DynamoTablesState {
  readonly tables: readonly string[]
  readonly hasMore: boolean
  readonly loading: boolean
  readonly error: string | null
  run: () => void
  loadMore: () => Promise<void>
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : 'unknown error'
}

function toNames(rs: ResultSet): string[] {
  return rs.rows.map((row) => (row[0]?.t === 'str' ? row[0].v : ''))
}

/** DynamoDB 테이블 목록(listTables). 연결 시 자동으로 한 번 조회하고, loadMore는
 *  불투명 커서로 이어읽는다. */
export function useDynamoTables(gateway: OperationGateway, connectionId: string): DynamoTablesState {
  const [tables, setTables] = useState<readonly string[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mounted = useRef(true)
  const latest = useRef(0)
  const inFlight = useRef(false)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const load = useCallback(
    async (pageCursor: string | null, append: boolean, token: number) => {
      if (inFlight.current) return
      inFlight.current = true
      setLoading(true)
      if (!append) setError(null)
      try {
        const outcome = await gateway.run({
          requestId: crypto.randomUUID(),
          connectionId,
          operation: { kind: 'dynamo', op: 'listTables' },
          page: { cursor: pageCursor, maxRows: MAX_ROWS, maxBytes: MAX_BYTES },
        })
        if (token !== latest.current || !mounted.current) return
        if (outcome.ok && outcome.payload.kind === 'rows') {
          const rs = outcome.payload.rows
          setTables((prev) => (append ? [...prev, ...toNames(rs)] : toNames(rs)))
          setCursor(rs.page.cursor)
          setHasMore(rs.page.hasMore)
        } else if (!outcome.ok) setError(failureText(outcome))
      } catch (e) {
        if (token === latest.current && mounted.current) setError(messageOf(e))
      } finally {
        if (token === latest.current) { setLoading(false); inFlight.current = false }
      }
    },
    [gateway, connectionId],
  )

  const run = useCallback(() => {
    const token = latest.current + 1
    latest.current = token
    inFlight.current = false
    setTables([]); setCursor(null); setHasMore(false)
    void load(null, false, token)
  }, [load])

  // 연결이 바뀌면 초기화하고 자동으로 목록을 불러온다.
  useEffect(() => {
    const token = latest.current + 1
    latest.current = token
    inFlight.current = false
    setTables([]); setCursor(null); setHasMore(false); setError(null)
    void load(null, false, token)
  }, [connectionId, load])

  const loadMore = useCallback(async () => {
    if (!hasMore || cursor === null) return
    await load(cursor, true, latest.current)
  }, [hasMore, cursor, load])

  return { tables, hasMore, loading, error, run, loadMore }
}
