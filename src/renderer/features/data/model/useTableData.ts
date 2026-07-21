import { useCallback, useEffect, useRef, useState } from 'react'
import type { BrowseSort } from '../../../../shared/types/operation'
import type { ColumnDescriptor, ResultSet } from '../../../../shared/types/resultSet'
import type { WireValue } from '../../../../shared/types/wire'
import type { OperationGateway } from '../../../gateways/ports/OperationGateway'
import type { TableSelection } from '../../../entities/schema-tree'

const MAX_ROWS = 1000
const MAX_BYTES = 8 * 1024 * 1024

export interface TableDataState {
  readonly columns: readonly ColumnDescriptor[]
  readonly rows: readonly (readonly WireValue[])[]
  readonly hasMore: boolean
  loadMore: () => Promise<void>
  reload: () => void
  readonly loading: boolean
  readonly error: string | null
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : 'unknown error'
}

export function useTableData(
  gateway: OperationGateway,
  connectionId: string,
  selection: TableSelection | null,
  sort: BrowseSort | undefined,
): TableDataState {
  const [columns, setColumns] = useState<readonly ColumnDescriptor[]>([])
  const [rows, setRows] = useState<readonly (readonly WireValue[])[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reloadTick, setReloadTick] = useState(0)
  const mounted = useRef(true)
  const latest = useRef(0)
  const inFlight = useRef(false)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const schema = selection?.schema ?? null
  const table = selection?.table ?? null
  const sortKey = sort ? `${sort.column}:${sort.direction}` : ''

  const apply = useCallback((rs: ResultSet, append: boolean) => {
    setColumns(rs.columns)
    setRows((prev) => (append ? [...prev, ...rs.rows] : [...rs.rows]))
    setCursor(rs.page.cursor)
    setHasMore(rs.page.hasMore)
  }, [])

  const runBrowse = useCallback(
    async (pageCursor: string | null, append: boolean, token: number) => {
      if (schema === null || table === null) return
      if (inFlight.current) return
      inFlight.current = true
      setLoading(true)
      if (!append) setError(null)
      try {
        const outcome = await gateway.run({
          requestId: crypto.randomUUID(),
          connectionId,
          operation: { kind: 'data', op: 'browse', schema, table, ...(sort ? { sort } : {}) },
          page: { cursor: pageCursor, maxRows: MAX_ROWS, maxBytes: MAX_BYTES },
        })
        if (token !== latest.current || !mounted.current) return
        if (outcome.ok && outcome.payload.kind === 'rows') apply(outcome.payload.rows, append)
        else if (!outcome.ok) setError(outcome.reason)
      } catch (e) {
        if (token === latest.current && mounted.current) setError(messageOf(e))
      } finally {
        if (token === latest.current) { setLoading(false); inFlight.current = false }
      }
    },
    [gateway, connectionId, schema, table, sort, apply],
  )

  // 선택/정렬이 바뀌면 첫 페이지부터 재조회. 이전 응답은 token으로 버린다.
  useEffect(() => {
    const token = latest.current + 1
    latest.current = token
    inFlight.current = false
    setRows([]); setColumns([]); setCursor(null); setHasMore(false)
    if (schema === null || table === null) { setLoading(false); setError(null); return }
    void runBrowse(null, false, token)
  }, [gateway, connectionId, schema, table, sortKey, reloadTick])

  const loadMore = useCallback(async () => {
    if (!hasMore || cursor === null) return
    await runBrowse(cursor, true, latest.current)
  }, [hasMore, cursor, runBrowse])

  const reload = useCallback(() => setReloadTick((n) => n + 1), [])

  return { columns, rows, hasMore, loadMore, reload, loading, error }
}
