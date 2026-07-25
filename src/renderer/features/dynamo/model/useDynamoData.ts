import { useCallback, useEffect, useRef, useState } from 'react'
import type { ColumnDescriptor, ResultSet } from '../../../../shared/types/resultSet'
import type { WireValue } from '../../../../shared/types/wire'
import type { OperationGateway } from '../../../gateways/ports/OperationGateway'

const MAX_ROWS = 1000
const MAX_BYTES = 8 * 1024 * 1024

type Query = { readonly mode: 'scan'; readonly table: string } | { readonly mode: 'partiql'; readonly statement: string }

export interface DynamoDataState {
  readonly columns: readonly ColumnDescriptor[]
  readonly rows: readonly (readonly WireValue[])[]
  readonly hasMore: boolean
  readonly loading: boolean
  readonly error: string | null
  runScan: (table: string) => void
  runPartiql: (statement: string) => void
  loadMore: () => Promise<void>
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : 'unknown error'
}

/**
 * DynamoDB scan/PartiQL 결과. Documents 뷰의 useDocumentsData와 같은 명시적
 * 트리거 방식이다 — 테이블을 고르거나 PartiQL을 입력하고 Run을 눌러야 실행된다.
 * loadMore는 DynamoDB 불투명 커서로 이어읽는다.
 */
export function useDynamoData(gateway: OperationGateway, connectionId: string): DynamoDataState {
  const [columns, setColumns] = useState<readonly ColumnDescriptor[]>([])
  const [rows, setRows] = useState<readonly (readonly WireValue[])[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mounted = useRef(true)
  const latest = useRef(0)
  const inFlight = useRef(false)
  const lastQuery = useRef<Query | null>(null)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  useEffect(() => {
    latest.current += 1
    inFlight.current = false
    lastQuery.current = null
    setRows([]); setColumns([]); setCursor(null); setHasMore(false); setError(null); setLoading(false)
  }, [connectionId])

  const exec = useCallback(
    async (query: Query, pageCursor: string | null, append: boolean, token: number) => {
      if (inFlight.current) return
      inFlight.current = true
      setLoading(true)
      if (!append) setError(null)
      try {
        const operation =
          query.mode === 'scan'
            ? { kind: 'dynamo' as const, op: 'scan' as const, table: query.table }
            : { kind: 'dynamo' as const, op: 'partiql' as const, statement: query.statement }
        const outcome = await gateway.run({
          requestId: crypto.randomUUID(),
          connectionId,
          operation,
          page: { cursor: pageCursor, maxRows: MAX_ROWS, maxBytes: MAX_BYTES },
        })
        if (token !== latest.current || !mounted.current) return
        if (outcome.ok && outcome.payload.kind === 'rows') {
          const rs: ResultSet = outcome.payload.rows
          setColumns(rs.columns)
          setRows((prev) => (append ? [...prev, ...rs.rows] : [...rs.rows]))
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

  const start = useCallback(
    (query: Query) => {
      const token = latest.current + 1
      latest.current = token
      inFlight.current = false
      lastQuery.current = query
      setRows([]); setColumns([]); setCursor(null); setHasMore(false)
      void exec(query, null, false, token)
    },
    [exec],
  )

  const runScan = useCallback((table: string) => start({ mode: 'scan', table }), [start])
  const runPartiql = useCallback((statement: string) => start({ mode: 'partiql', statement }), [start])

  const loadMore = useCallback(async () => {
    if (!hasMore || cursor === null || lastQuery.current === null) return
    await exec(lastQuery.current, cursor, true, latest.current)
  }, [hasMore, cursor, exec])

  return { columns, rows, hasMore, loading, error, runScan, runPartiql, loadMore }
}
