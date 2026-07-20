import { useCallback, useRef, useState } from 'react'
import type { ColumnDescriptor, ResultSet } from '../../../../shared/types/resultSet'
import type { WireValue } from '../../../../shared/types/wire'
import type { OperationGateway } from '../../../gateways/ports/OperationGateway'
import type { OperationRequestDto } from '../../../../shared/contracts/operationDto'

const MAX_ROWS = 1000
const MAX_BYTES = 8 * 1024 * 1024

export interface QueryRunnerState {
  readonly sql: string
  setSql: (v: string) => void
  run: () => Promise<void>
  cancel: () => void
  readonly running: boolean
  readonly columns: readonly ColumnDescriptor[]
  readonly rows: readonly (readonly WireValue[])[]
  readonly rowsAffected: number | null
  readonly notices: readonly string[]
  readonly hasMore: boolean
  loadMore: () => Promise<void>
  readonly error: string | null
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : 'unknown error'
}

export function useQueryRunner(gateway: OperationGateway, connectionId: string): QueryRunnerState {
  const [sql, setSql] = useState('')
  const [running, setRunning] = useState(false)
  const [columns, setColumns] = useState<readonly ColumnDescriptor[]>([])
  const [rows, setRows] = useState<readonly (readonly WireValue[])[]>([])
  const [rowsAffected, setRowsAffected] = useState<number | null>(null)
  const [notices, setNotices] = useState<readonly string[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const activeRequestId = useRef<string | null>(null)
  const inFlight = useRef(false)

  const apply = useCallback((rs: ResultSet, append: boolean) => {
    setColumns(rs.columns)
    setRows((prev) => (append ? [...prev, ...rs.rows] : [...rs.rows]))
    setRowsAffected(rs.meta.rowsAffected)
    setNotices(rs.meta.notices ?? [])
    setCursor(rs.page.cursor)
    setHasMore(rs.page.hasMore)
  }, [])

  const execute = useCallback(
    async (pageCursor: string | null, append: boolean) => {
      // 같은 틱에서 재진입을 막는 동기 가드. state(running)는 갱신이
      // 비동기라 스크롤 이벤트가 연달아 들어오는 사이 재확인해도 아직
      // false로 보일 수 있다 — ref만 그 자리에서 즉시 막을 수 있다.
      if (inFlight.current) return
      inFlight.current = true
      const requestId = crypto.randomUUID()
      activeRequestId.current = requestId
      setRunning(true)
      setError(null)
      const request: OperationRequestDto = {
        requestId,
        connectionId,
        operation: { kind: 'sql', sql },
        page: { cursor: pageCursor, maxRows: MAX_ROWS, maxBytes: MAX_BYTES },
      }
      try {
        const outcome = await gateway.run(request)
        if (outcome.ok) {
          if (outcome.payload.kind === 'rows') apply(outcome.payload.rows, append)
        } else {
          setError(outcome.reason)
        }
      } catch (e) {
        setError(messageOf(e))
      } finally {
        setRunning(false)
        if (activeRequestId.current === requestId) activeRequestId.current = null
        inFlight.current = false
      }
    },
    [gateway, connectionId, sql, apply],
  )

  const run = useCallback(async () => {
    setRows([])
    setColumns([])
    setRowsAffected(null)
    setNotices([])
    setCursor(null)
    setHasMore(false)
    await execute(null, false)
  }, [execute])

  const loadMore = useCallback(async () => {
    if (!hasMore || cursor === null) return
    await execute(cursor, true)
  }, [execute, hasMore, cursor])

  const cancel = useCallback(() => {
    const id = activeRequestId.current
    if (id !== null) void gateway.cancel(id)
  }, [gateway])

  return {
    sql, setSql, run, cancel, running,
    columns, rows, rowsAffected, notices, hasMore, loadMore, error,
  }
}
