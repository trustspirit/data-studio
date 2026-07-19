import { estimateWireBytes, type WireValue } from './wire'

export interface ColumnDescriptor {
  /** 표시용 컬럼 이름 */
  readonly name: string
  /** 엔진이 보고한 타입 이름. 렌더러가 힌트로만 쓴다. */
  readonly type: string
}

export interface PageInfo {
  /** 다음 페이지를 요청할 때 그대로 되돌려주는 불투명 커서. 더 없으면 null. */
  readonly cursor: string | null
  readonly hasMore: boolean
  readonly rowCount: number
  readonly bytes: number
}

export interface ResultMeta {
  readonly durationMs: number
  readonly truncatedRows: boolean
  readonly truncatedBytes: boolean
  readonly notices?: readonly string[]
}

export interface ResultSet {
  readonly requestId: string
  readonly columns: readonly ColumnDescriptor[]
  readonly rows: readonly (readonly WireValue[])[]
  readonly page: PageInfo
  readonly meta: ResultMeta
}

export interface PageRequest {
  /** 이전 응답의 `page.cursor`. 첫 페이지는 null. */
  readonly cursor: string | null
  readonly maxRows: number
  readonly maxBytes: number
}

export interface BuildResultSetInput {
  readonly requestId: string
  readonly columns: readonly ColumnDescriptor[]
  readonly rows: readonly (readonly WireValue[])[]
  readonly page: PageRequest
  readonly durationMs: number
  /** 드라이버가 계산한 다음 커서. 더 없으면 null. */
  readonly nextCursor: string | null
  readonly notices?: readonly string[]
}

/**
 * 드라이버가 읽어온 행을 페이지 상한에 맞춰 잘라내고 결과를 조립한다.
 *
 * byte 상한이 행 수 상한보다 **먼저** 적용된다. 4만 행짜리 테이블에서 행 수만
 * 제한하면 넓은 행 1000개가 수십 MB가 되어 IPC 직렬화에서 앱이 멈춘다.
 *
 * 첫 행이 단독으로 상한을 넘어도 그 행은 담는다 — 한 행도 못 돌려주면 호출자가
 * 커서를 전진시킬 방법이 없어 무한 루프가 된다.
 */
export function buildResultSet(input: BuildResultSetInput): ResultSet {
  const kept: (readonly WireValue[])[] = []
  let bytes = 0
  let truncatedRows = false
  let truncatedBytes = false

  for (const row of input.rows) {
    if (kept.length >= input.page.maxRows) {
      truncatedRows = true
      break
    }

    const rowBytes = row.reduce((sum, value) => sum + estimateWireBytes(value), 0)

    if (kept.length > 0 && bytes + rowBytes > input.page.maxBytes) {
      truncatedBytes = true
      break
    }

    kept.push(row)
    bytes += rowBytes

    if (bytes > input.page.maxBytes) {
      // 첫 행이 단독으로 상한을 넘은 경우. 담기는 했지만 절단으로 표시한다.
      truncatedBytes = true
      break
    }
  }

  const truncated = truncatedRows || truncatedBytes

  return {
    requestId: input.requestId,
    columns: input.columns,
    rows: kept,
    page: {
      cursor: input.nextCursor,
      hasMore: truncated || input.nextCursor !== null,
      rowCount: kept.length,
      bytes,
    },
    meta: {
      durationMs: input.durationMs,
      truncatedRows,
      truncatedBytes,
      ...(input.notices === undefined ? {} : { notices: input.notices }),
    },
  }
}
