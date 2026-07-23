import { useCallback, useEffect, useRef, useState } from 'react'
import type { ColumnDescriptor, ResultSet } from '../../../../shared/types/resultSet'
import type { WireValue } from '../../../../shared/types/wire'
import type { OperationGateway } from '../../../gateways/ports/OperationGateway'

const MAX_ROWS = 1000
const MAX_BYTES = 8 * 1024 * 1024

export interface DocumentsDataState {
  readonly columns: readonly ColumnDescriptor[]
  readonly rows: readonly (readonly WireValue[])[]
  readonly hasMore: boolean
  readonly loading: boolean
  readonly error: string | null
  /** 선택된 컬렉션 + 필터로 find를 처음부터 실행한다(직전 결과는 버린다). */
  run: (collection: string, filter: string) => void
  loadMore: () => Promise<void>
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : 'unknown error'
}

/**
 * 문서 find 결과. DataView의 `useTableData`와 달리 선택이 바뀐다고 자동으로
 * 조회하지 않는다 — Documents 뷰는 필터를 입력하고 Run을 눌러야 실행되는
 * 명시적 트리거 방식이다(브리프 §View design).
 */
export function useDocumentsData(gateway: OperationGateway, connectionId: string): DocumentsDataState {
  const [columns, setColumns] = useState<readonly ColumnDescriptor[]>([])
  const [rows, setRows] = useState<readonly (readonly WireValue[])[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mounted = useRef(true)
  const latest = useRef(0)
  const inFlight = useRef(false)
  const lastQuery = useRef<{ collection: string; filter: string } | null>(null)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  // 연결이 바뀌면 이전 연결의 결과가 새 연결에 남아있지 않도록 초기화한다
  // (useTableData가 selection 변경 시 하는 것과 같은 이유).
  useEffect(() => {
    latest.current += 1
    inFlight.current = false
    lastQuery.current = null
    setRows([]); setColumns([]); setCursor(null); setHasMore(false); setError(null); setLoading(false)
  }, [connectionId])

  const apply = useCallback((rs: ResultSet, append: boolean) => {
    setColumns(rs.columns)
    setRows((prev) => (append ? [...prev, ...rs.rows] : [...rs.rows]))
    setCursor(rs.page.cursor)
    setHasMore(rs.page.hasMore)
  }, [])

  const runFind = useCallback(
    async (collection: string, filter: string, pageCursor: string | null, append: boolean, token: number) => {
      if (inFlight.current) return
      inFlight.current = true
      setLoading(true)
      if (!append) setError(null)
      try {
        const outcome = await gateway.run({
          requestId: crypto.randomUUID(),
          connectionId,
          operation: { kind: 'document', op: 'find', collection, filter },
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
    [gateway, connectionId, apply],
  )

  const run = useCallback(
    (collection: string, filter: string) => {
      const token = latest.current + 1
      latest.current = token
      inFlight.current = false
      lastQuery.current = { collection, filter }
      setRows([]); setColumns([]); setCursor(null); setHasMore(false)
      void runFind(collection, filter, null, false, token)
    },
    [runFind],
  )

  const loadMore = useCallback(async () => {
    if (!hasMore || cursor === null || lastQuery.current === null) return
    await runFind(lastQuery.current.collection, lastQuery.current.filter, cursor, true, latest.current)
  }, [hasMore, cursor, runFind])

  return { columns, rows, hasMore, loading, error, run, loadMore }
}
