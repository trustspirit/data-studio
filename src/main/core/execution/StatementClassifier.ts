import type { StatementClassification } from '../driver/capabilities/SqlCapability'

/**
 * 마스킹 결과.
 *
 * `masked`는 입력과 **길이가 정확히 같은** 문자열이다 (§ 길이 불변식).
 * `versionedBodies`는 `/*!...*\/` 안에서 꺼낸 본문들로, MySQL에서만 실행되는
 * 코드다. 주 스트림에서는 평범한 주석으로 지워지고, 여기 따로 담겨
 * 별도로 분류된다.
 */
interface MaskResult {
  readonly masked: string
  readonly versionedBodies: readonly string[]
}

/**
 * 주석과 문자열 리터럴을 같은 길이의 공백으로 치환한다.
 *
 * 지우지 않고 **공백으로 바꾸는** 이유: 토큰 경계가 보존되어야
 * `SELECT/**\/1`이 `SELECT1`로 붙어 버리지 않는다.
 *
 * 이 함수가 이 층의 핵심이다. 스펙 §4.2의 우회 케이스 대부분이 "키워드를
 * 주석이나 리터럴 뒤에 숨기기"와 "리터럴 안의 키워드로 오탐 유발하기"이고,
 * 둘 다 여기서 결판난다.
 *
 * **길이 불변식**: 반환값의 길이는 항상 입력과 같다. `splitStatements`가
 * 마스킹된 사본의 인덱스를 원문에 그대로 대응시키기 때문에, 길이가 어긋나면
 * 문장 경계가 밀려 엉뚱한 곳에서 잘린다.
 *
 * @param backslashEscapes 문자열 리터럴 안에서 `\`를 이스케이프로 볼지 여부.
 *   MySQL은 그렇고, 표준 SQL(PostgreSQL의 `standard_conforming_strings=on`,
 *   SQL Server, Oracle)은 아니다. 이 층은 엔진 독립적이므로 어느 한쪽을
 *   고를 수 없다 — 호출자가 **양쪽 다** 돌려 보고 더 엄격한 쪽을 택한다.
 */
function maskSql(sql: string, backslashEscapes: boolean): MaskResult {
  const out: string[] = []
  const versionedBodies: string[] = []
  let i = 0

  const blank = (n: number): void => {
    out.push(' '.repeat(n))
  }

  while (i < sql.length) {
    const two = sql.slice(i, i + 2)

    if (two === '--') {
      // 줄 끝은 `\n`뿐 아니라 `\r`(옛 Mac 스타일 개행)도 될 수 있다.
      // `\n`만 찾으면 `\r`로만 끝나는 줄에서는 인덱스가 안 나와 문자열
      // 끝까지 전부 주석으로 지워버려, 그 뒤에 있는 진짜 코드(예: 다음
      // "줄"의 DROP)까지 함께 사라지는 미탐이 생긴다.
      const newline = /[\r\n]/.exec(sql.slice(i))
      const stop = newline === null ? sql.length : i + newline.index
      blank(stop - i)
      i = stop
      continue
    }

    if (two === '/*') {
      // 블록 주석은 **언제나** 닫는 `*/`까지를 한 덩어리로 본다.
      // 닫히지 않았으면 끝까지 주석으로 본다 — 코드로 되돌리면 그 안의
      // 키워드가 살아난다.
      const end = sql.indexOf('*/', i + 2)
      const stop = end === -1 ? sql.length : end + 2

      // `/*!...*/`(선택적으로 `/*!50000...*/`)는 MySQL의 버전 조건부
      // "주석"이다 — 다른 엔진에는 평범한 블록 주석이지만 MySQL은 안의
      // SQL을 실제로 실행한다. 이 분류기는 엔진 독립적이므로 **두 해석의
      // 합집합**을 취해야 한다:
      //
      //  1. 비-MySQL 해석: 주 스트림에서는 블록 전체를 평범한 주석으로
      //     지운다. 이렇게 해야 본문 안의 따옴표나 `--` 같은 여는 토큰이
      //     마스킹 상태를 닫는 `*/` **바깥으로 흘려보내지** 못한다.
      //     (본문을 그대로 코드로 되돌리면 `SELECT 1 /*!' */; DROP TABLE x`
      //     에서 본문의 `'`가 뒤의 `; DROP`까지 리터럴로 삼켜 미탐이 된다.)
      //  2. MySQL 해석: 본문을 따로 꺼내 두었다가 별도로 분류한다. 거기서
      //     쓰기가 나오면 전체를 쓰기로 올린다.
      const versioned = /^\/\*!\d*/.exec(sql.slice(i, stop))
      if (versioned !== null) {
        const bodyStart = i + versioned[0].length
        const bodyEnd = end === -1 ? sql.length : end
        if (bodyEnd > bodyStart) versionedBodies.push(sql.slice(bodyStart, bodyEnd))
      }

      blank(stop - i)
      i = stop
      continue
    }

    const ch = sql[i]

    if (ch === "'" || ch === '"') {
      let j = i + 1
      while (j < sql.length) {
        if (sql[j] === ch) {
          // 같은 따옴표 두 번은 이스케이프다 ('it''s').
          //
          // 주의: 이 분기는 **현재 외연적으로 무의미하다(inert)**. 마스킹이
          // 길이만 보존하는 공백을 뱉기 때문에, "닫고 곧바로 다시 연다"와
          // "건너뛰고 계속한다"가 정확히 같은 구간을 같은 길이로 소비한다.
          // 리뷰어가 길이 7 이하 전수 탐색(97,655건)과 100만 건 차등 퍼징으로
          // 제거해도 결과가 달라지지 않음을 확인했다.
          //
          // 그럼에도 **지우지 않는다**: 마스커가 리터럴 내용을 실제로 내보내거나,
          // 리터럴 경계를 기록하거나, 구간(span)을 반환하도록 바뀌는 순간 다시
          // 유효해진다. 그때 이 분기가 없으면 'it''s ok; DROP TABLE x' 에서
          // 리터럴이 중간에 끊긴 것으로 보여 뒤의 코드/리터럴이 뒤바뀐다.
          if (sql[j + 1] === ch) {
            j += 2
            continue
          }
          j += 1
          break
        }
        if (backslashEscapes && sql[j] === '\\') {
          // 길이 불변식: 문자열 끝의 `\`에서 `j`가 `sql.length`를 넘어가면
          // 소비한 것보다 많은 공백을 뱉는다.
          j = Math.min(j + 2, sql.length)
          continue
        }
        j += 1
      }
      blank(j - i)
      i = j
      continue
    }

    // PostgreSQL 달러 인용: $tag$ ... $tag$
    const dollar = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i))
    if (dollar !== null) {
      const tag = dollar[0]
      const end = sql.indexOf(tag, i + tag.length)
      // 닫히지 않은 달러 인용은 끝까지 리터럴로 본다. 코드로 되돌리면
      // 그 안의 키워드가 살아난다.
      const stop = end === -1 ? sql.length : end + tag.length
      blank(stop - i)
      i = stop
      continue
    }

    out.push(ch ?? '')
    i += 1
  }

  return { masked: out.join(''), versionedBodies }
}

/**
 * 주석과 문자열 리터럴을 같은 길이의 공백으로 치환한다.
 *
 * 기본값은 표준 SQL 해석(`\`는 평범한 문자)이다. 분류는
 * `classifyStatement`가 MySQL 해석까지 함께 돌려 더 엄격한 쪽을 택한다.
 *
 * @param backslashEscapes MySQL처럼 `\`를 문자열 이스케이프로 볼지 여부.
 */
export function stripCommentsAndLiterals(sql: string, backslashEscapes = false): string {
  return maskSql(sql, backslashEscapes).masked
}

function splitStatementsWith(sql: string, backslashEscapes: boolean): string[] {
  const { masked } = maskSql(sql, backslashEscapes)
  const parts: string[] = []
  let start = 0

  for (let i = 0; i < masked.length; i += 1) {
    if (masked[i] === ';') {
      parts.push(sql.slice(start, i))
      start = i + 1
    }
  }
  parts.push(sql.slice(start))

  return parts.filter((part) => part.trim().length > 0)
}

/**
 * 문장을 세미콜론으로 나눈다. 주석·리터럴 안의 세미콜론은 무시한다.
 *
 * 원문을 그대로 자르되, **자를 위치는 마스킹된 사본에서 찾는다** — 그래야
 * 반환값이 실행 가능한 원문으로 남으면서도 리터럴 안의 세미콜론에 속지 않는다.
 */
export function splitStatements(sql: string): string[] {
  return splitStatementsWith(sql, false)
}

const WRITE_HEADS = new Set([
  'insert', 'update', 'delete', 'merge', 'upsert', 'replace',
  'create', 'alter', 'drop', 'truncate', 'rename', 'comment',
  'grant', 'revoke',
  'begin', 'commit', 'rollback', 'savepoint', 'set', 'reset',
  'copy', 'import', 'load', 'lock', 'refresh', 'reindex', 'cluster', 'analyze',
])

const READ_HEADS = new Set(['select', 'show', 'describe', 'desc', 'values', 'table'])

/** 본문 어디에 나타나도 쓰기를 뜻하는 키워드 (CTE 안의 쓰기 등) */
const WRITE_ANYWHERE = /\b(insert\s+into|update\s+\w|delete\s+from|merge\s+into|truncate\s|drop\s|alter\s|create\s|grant\s|revoke\s)/i

/** 함수·프로시저 호출로 보이는 형태. 부작용을 정적으로 판정할 수 없다. */
const CALL_LIKE = /\b[a-z_][a-z0-9_]*\s*\(/i

/**
 * 이미 세미콜론으로 나뉜 **단일** 문장 하나를 분류한다. 여러 문장을 다루는
 * 상위 규칙은 `classifyStatement`가 맡는다.
 */
function classifySingleStatement(raw: string, backslashEscapes: boolean): StatementClassification {
  const result = maskSql(raw, backslashEscapes)

  // MySQL 버전 조건부 주석 본문은 MySQL에서 실제로 실행된다. 쓰기면 올린다.
  // (본문 길이는 원문보다 항상 짧으므로 재귀는 반드시 끝난다.)
  for (const body of result.versionedBodies) {
    if (classifyStatement(body) === 'write') return 'write'
  }

  const masked = result.masked.trim()
  if (masked.length === 0) return 'unknown'

  if (WRITE_ANYWHERE.test(masked)) return 'write'

  const head = /^([a-z_]+)/i.exec(masked)?.[1]?.toLowerCase()
  if (head === undefined) return 'unknown'

  if (head === 'explain') {
    // EXPLAIN ANALYZE는 계획만 보는 게 아니라 쿼리를 실제로 실행한다.
    const rest = masked.slice('explain'.length)
    if (/\banalyze\b/i.test(rest)) return 'write'
    return 'read'
  }

  if (WRITE_HEADS.has(head)) return 'write'

  if (head === 'with') {
    // CTE 본문의 쓰기는 WRITE_ANYWHERE가 이미 잡았다. 여기까지 왔으면
    // 읽기 전용 CTE다.
    return 'read'
  }

  if (READ_HEADS.has(head)) {
    // SELECT drop_everything() — 함수의 부작용은 정적으로 알 수 없다.
    return CALL_LIKE.test(masked) ? 'unknown' : 'read'
  }

  return 'unknown'
}

function classifyUnder(sql: string, backslashEscapes: boolean): StatementClassification {
  const statements = splitStatementsWith(sql, backslashEscapes)

  if (statements.length === 0) return 'unknown'

  if (statements.length > 1) {
    // 다중 문장은 단일 문장으로 확신할 수 없다 — AI 경로는 이를 거부한다.
    // 다만 그중 하나라도 명백한 쓰기라면(예: 세미콜론 뒤 주석에 숨긴
    // DROP) 'unknown'으로 완화하지 않고 'write'를 그대로 보고한다.
    // 미탐(쓰기를 놓치는 것)이 사고이므로, 다중 문장이라는 이유로 이미
    // 확실한 쓰기 신호를 뭉갤 이유가 없다.
    const hasWrite = statements.some(
      (part) => classifySingleStatement(part, backslashEscapes) === 'write',
    )
    return hasWrite ? 'write' : 'unknown'
  }

  return classifySingleStatement(statements[0] ?? '', backslashEscapes)
}

/**
 * 문장을 분류한다. 엔진 독립적인 공통 층이며, 드라이버의 `classify`가 엔진
 * 고유 판정을 더한다. **둘 중 하나라도 read가 아니면 쓰기로 취급한다.**
 *
 * 확신할 수 없으면 항상 `'unknown'`이다. 오탐(읽기를 쓰기로 판정)은 사용자가
 * 승인 한 번 더 누르는 불편이지만, 미탐(쓰기를 읽기로 판정)은 AI가 승인 없이
 * 데이터를 지우는 사고다. 애매하면 언제나 미탐 쪽을 피한다.
 *
 * 백슬래시 이스케이프는 엔진마다 다르고(§ `maskSql`), 어느 쪽도 다른 쪽을
 * 포함하지 않는다:
 *   - `SELECT 'a\'; DROP TABLE x`  — 표준 해석에서만 `; DROP`이 드러난다.
 *   - `SELECT 'a\'b'; DROP TABLE x` — MySQL 해석에서만 `; DROP`이 드러난다.
 * 그래서 **양쪽 해석을 다 돌리고 더 엄격한 결과를 택한다.**
 */
export function classifyStatement(sql: string): StatementClassification {
  const standard = classifyUnder(sql, false)
  if (standard === 'write') return 'write'

  const mysql = classifyUnder(sql, true)
  if (mysql === 'write') return 'write'

  return standard === 'unknown' || mysql === 'unknown' ? 'unknown' : 'read'
}
