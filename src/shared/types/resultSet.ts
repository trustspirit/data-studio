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
  /**
   * 이 실행이 실제로 변경한 행 수(`UPDATE`/`DELETE`/`INSERT` 등). 엔진이 이
   * 값을 보고하지 않으면 `null`이다.
   *
   * `null`과 `0`은 다른 뜻이다: `null`은 "이 엔진/드라이버가 이 값을 보고하지
   * 않는다"는 뜻이고, `0`은 "실제로 0개 행이 영향을 받았다"는 뜻이다. 이 둘을
   * 섞으면 "0 rows updated"와 "modified count unavailable"을 사용자에게
   * 구분해 보여줄 수 없다.
   */
  readonly rowsAffected?: number | null
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
  /**
   * 오프셋 `index`의 행부터 다시 읽기 위한 커서를 준다.
   * `index === rows.length`는 "이 배치 끝 다음" 위치를 뜻하며, 더 읽을 것이
   * 없으면 null을 돌려준다.
   *
   * 호출 규약(드라이버 구현자용): `buildResultSet` 한 번당 **정확히 한 번**
   * 호출되며, `index`는 항상 `0 <= index <= rows.length` 범위다. 반환값은
   * 결과에 그대로 실려 IPC로 나가므로 structuredClone 가능한 값이어야 한다.
   *
   * `nextCursor: string | null`을 그대로 전달받는 대신 콜백으로 받는 이유:
   * 드라이버가 배치 전체 기준으로 계산한 커서를 곧이곧대로 넘기면, byte/행 수
   * 상한이 뒷부분 행을 잘라낸 뒤에도 커서는 잘려나간 행들 "너머"를 가리키게
   * 된다. 호출자가 그 커서로 이어 읽으면 잘려나간 행은 영영 사라진다.
   * `buildResultSet`은 실제로 담은 행 수(`kept.length`)를 넘겨 호출하므로,
   * 반환되는 커서는 항상 "실제로 돌려준 행 바로 다음"을 가리킨다.
   */
  readonly cursorAt: (index: number) => string | null
  readonly notices?: readonly string[]
  /**
   * 쓰기 문장이 실제로 변경한 행 수. 드라이버가 `SqlCapability.execute`에서
   * `UPDATE`/`DELETE`/`INSERT` 결과를 조립할 때 넘긴다. 생략하면
   * `meta.rowsAffected`는 `null`이 된다(엔진이 값을 보고하지 않는 것과 동일하게
   * 취급) — `SELECT`처럼 이 개념이 없는 문장에서는 생략하면 된다.
   */
  readonly rowsAffected?: number | null
}

/**
 * 드라이버가 읽어온 행을 페이지 상한에 맞춰 잘라내고 결과를 조립한다.
 *
 * byte 상한이 행 수 상한보다 **먼저** 적용된다. 4만 행짜리 테이블에서 행 수만
 * 제한하면 넓은 행 1000개가 수십 MB가 되어 IPC 직렬화에서 앱이 멈춘다.
 *
 * 첫 행이 단독으로 상한을 넘어도 그 행은 담는다 — 한 행도 못 돌려주면 호출자가
 * 커서를 전진시킬 방법이 없어 무한 루프가 된다.
 *
 * 반환하는 `page.cursor`는 실제로 담은 행 수(`kept.length`)로 `cursorAt`을
 * 호출해 얻는다 — 오퍼받은 배치 전체 길이가 아니라. 그래야 커서가 항상 "실제로
 * 돌려준 행 바로 다음"을 가리켜서, 잘려나간 행이 있어도 다음 요청이 그 행부터
 * 다시 읽는다. `page.hasMore`도 이 커서가 null이 아니거나 이번에 잘려나간
 * 행이 있으면 true다 — 담은 행이 하나뿐이고(byte 상한 예외) 그게 오퍼받은
 * 마지막 행이며 드라이버 쪽에도 더 읽을 게 없으면(`cursorAt`이 null을 주면)
 * `hasMore`는 false가 되어, 호출자가 `cursor: null`로 영원히 같은 행을
 * 되받는 무한 루프에 빠지지 않는다.
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

  const cursor = input.cursorAt(kept.length)

  return {
    requestId: input.requestId,
    columns: input.columns,
    rows: kept,
    page: {
      cursor,
      hasMore: kept.length < input.rows.length || cursor !== null,
      rowCount: kept.length,
      bytes,
    },
    meta: {
      durationMs: input.durationMs,
      truncatedRows,
      truncatedBytes,
      rowsAffected: input.rowsAffected ?? null,
      ...(input.notices === undefined ? {} : { notices: input.notices }),
    },
  }
}
