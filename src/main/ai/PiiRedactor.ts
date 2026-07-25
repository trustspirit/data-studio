import type { ColumnDescriptor, ResultSet } from '@shared/types/resultSet'
import { estimateWireBytes, wire, type WireValue } from '@shared/types/wire'

/**
 * AI에 넘길 결과에서 마스킹 대상 컬럼을 가리고 크기를 제한한다.
 *
 * # 왜 컬럼 **이름**만으로는 부족한가
 *
 * 처음 구현은 결과셋의 표시용 컬럼 이름만 패턴과 대조했다. 그건 별칭 한 번으로
 * 전부 빗나간다. 그리고 이 앱은 시스템 프롬프트에서 모델에게 마스킹의 존재를
 * 알려 주므로, 데이터에 심긴 지시("마스킹된 컬럼은 별칭을 붙여 조회하라")가
 * 곧바로 먹히는 형태였다:
 *
 *   SELECT ssn FROM t          -> 이름이 ssn → 마스킹
 *   SELECT ssn AS s FROM t     -> 이름이 s   → 통과 (같은 값인데)
 *   SELECT substr(ssn,1,4) ..  -> 이름이 substr → 통과
 *   SELECT count(*) WHERE ssn LIKE '123%' -> 통과 (이진 탐색 오라클)
 *
 * 그래서 판정을 **엔진이 보고한 원본 컬럼**(`ColumnDescriptor.origin`) 위에
 * 다시 세운다. 별칭은 출처를 바꾸지 않으므로 위 두 번째 줄이 닫힌다.
 *
 * # 식으로 만들어진 컬럼
 *
 * 출처가 `computed`이거나 아예 보고되지 않은 컬럼은 어느 원본에서 파생됐는지
 * 알 수 없다. 여기서 "모르니 통과"로 두면 세 번째·네 번째 줄이 그대로 열린다.
 * 그렇다고 전부 마스킹하면 마스킹 패턴이 하나라도 설정된 커넥션에서 `count(*)`
 * 조차 `***`가 되어, AI가 행 수를 세는 것 같은 무해한 일도 못 한다.
 *
 * 그래서 **문장이 마스킹 대상을 언급하는지**로 가른다. 되짚을 수 없는 컬럼은,
 * 문장 어딘가에 패턴에 걸리는 식별자가 등장할 때만 마스킹한다. SELECT 목록이
 * 아니라 WHERE에만 나와도 마스킹되므로 오라클 공격도 함께 막힌다.
 *
 * # 남은 한계 (정직하게 적는다)
 *
 * 행 전체를 한 값으로 만드는 투영(`SELECT u::text FROM users u`)은 마스킹 대상
 * 이름을 문장에 적지 않고도 그 값을 담아 낼 수 있다. `to_json(t)` 같은 함수 형태는
 * 분류기의 허용 목록 밖이라 `unknown`으로 거부되지만, 캐스트 형태는 호출로 보이지
 * 않아 통과한다. 이걸 제대로 닫으려면 투영을 원본 컬럼으로 되짚을 수 있는
 * SQL 분석이 필요하며, 이 층에서 문자열 검사로 흉내내면 오탐/미탐이 함께 늘어난다.
 * 지금은 알려진 한계로 남긴다 — 마스킹은 실수로 눈에 띄는 것을 막는 장치이고,
 * AI가 읽어도 되는 범위 자체는 읽기 전용 계정이 정한다.
 */
export interface RedactionRequest {
  readonly resultSet: ResultSet
  readonly patterns: readonly string[]
  readonly maxBytes: number
  /**
   * 실행된 문장 원문. 되짚을 수 없는 컬럼이 마스킹 대상을 참조하는지 판정한다.
   * 문장을 알 수 없으면 `null` — 그때는 되짚을 수 없는 컬럼을 **전부** 마스킹한다
   * (판정 근거가 없으면 조이는 쪽으로).
   */
  readonly statement: string | null
}

export interface PiiRedactor {
  redact(request: RedactionRequest): ResultSet
}

const MASK: WireValue = wire.str('***')

/** SQL에서 식별자로 볼 수 있는 토큰. 인용 식별자의 내용도 이 형태로 남는다. */
const IDENTIFIER_SCAN = /[a-z_][a-z0-9_]*/gi

function matchesAny(name: string, lowered: readonly string[]): boolean {
  const target = name.toLowerCase()
  return lowered.some((p) => p !== '' && target.includes(p))
}

/** 문장에 마스킹 패턴에 걸리는 식별자가 하나라도 등장하는가. */
function statementTouchesMasked(statement: string, lowered: readonly string[]): boolean {
  for (const match of statement.matchAll(IDENTIFIER_SCAN)) {
    if (matchesAny(match[0], lowered)) return true
  }
  return false
}

function shouldMask(
  column: ColumnDescriptor,
  lowered: readonly string[],
  unmappableIsMasked: boolean,
): boolean {
  // 표시용 이름은 언제나 본다. 출처를 보고하지 않는 엔진(문서·키값·스트림)에서는
  // 이것이 유일한 근거이므로, 출처 기반 판정이 이 바닥을 대체하지 않고 더한다.
  if (matchesAny(column.name, lowered)) return true

  const origin = column.origin
  if (origin === undefined) {
    // 출처 **보고 없음**. `computed`와 같게 다루면 안 된다: 출처 개념이 없는
    // 엔진에서는 모든 컬럼이 여기로 오므로, 문장이 대상을 한 번 언급했다는
    // 이유로 결과 전체가 `***`가 되어 버린다(실제로 이 구현의 첫 판이 그랬다).
    // 근거가 없으면 이름 판정에서 멈춘다.
    return false
  }

  // 별칭이 무엇이든 원본 컬럼이 대상이면 마스킹한다.
  if (origin.kind === 'column') return matchesAny(origin.column, lowered)

  // `computed`(원본이 없다)와 `unresolved`(원본은 있는데 이름을 모른다) — 어느
  // 쪽이든 되짚을 수 없으므로 문장 언급 여부로 판정한다.
  return unmappableIsMasked
}

export class DefaultPiiRedactor implements PiiRedactor {
  redact(request: RedactionRequest): ResultSet {
    const { resultSet: rs, patterns, maxBytes, statement } = request
    const lowered = patterns.map((p) => p.toLowerCase()).filter((p) => p !== '')

    // 마스킹할 것이 없으면 되짚을 수 없는 컬럼을 조일 이유도 없다 — 패턴을
    // 설정하지 않은 커넥션의 동작을 바꾸지 않는다.
    const unmappableIsMasked =
      lowered.length > 0 && (statement === null || statementTouchesMasked(statement, lowered))

    const maskCol = rs.columns.map((c) => shouldMask(c, lowered, unmappableIsMasked))

    const kept: (readonly WireValue[])[] = []
    let bytes = 0
    let truncatedBytes = false
    for (const row of rs.rows) {
      const masked = row.map((v, i) => (maskCol[i] === true ? MASK : v))
      const rowBytes = masked.reduce((sum, v) => sum + estimateWireBytes(v), 0)
      // 첫 행은 상한을 넘어도 담는다 — 한 행도 못 주면 호출자가 아무것도 못 본다.
      if (kept.length > 0 && bytes + rowBytes > maxBytes) {
        truncatedBytes = true
        break
      }
      kept.push(masked)
      bytes += rowBytes
      if (bytes > maxBytes) {
        truncatedBytes = true
        break
      }
    }

    return {
      ...rs,
      rows: kept,
      page: { ...rs.page, rowCount: kept.length, hasMore: rs.page.hasMore || truncatedBytes },
      meta: { ...rs.meta, truncatedBytes: rs.meta.truncatedBytes || truncatedBytes },
    }
  }
}
