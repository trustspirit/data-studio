import type { StatementClassification } from '../driver/capabilities/SqlCapability'

/**
 * 주석과 문자열 리터럴을 같은 길이의 공백으로 치환한다.
 *
 * 지우지 않고 **공백으로 바꾸는** 이유: 토큰 경계가 보존되어야
 * `SELECT/**\/1`이 `SELECT1`로 붙어 버리지 않는다.
 *
 * 이 함수가 이 층의 핵심이다. 스펙 §4.2의 우회 케이스 대부분이 "키워드를
 * 주석이나 리터럴 뒤에 숨기기"와 "리터럴 안의 키워드로 오탐 유발하기"이고,
 * 둘 다 여기서 결판난다.
 */
export function stripCommentsAndLiterals(sql: string): string {
  const out: string[] = []
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
      // `/*!...*/`(선택적으로 `/*!50000...*/`)는 MySQL의 버전 조건부
      // "주석"이다 — 다른 엔진에는 평범한 블록 주석이지만 MySQL은 안의
      // SQL을 실제로 실행한다. 이걸 일반 주석처럼 통째로 지우면 그 안에
      // 숨긴 DROP 같은 쓰기가 사라져 미탐(사고)이 된다. 그래서 이 경우엔
      // `/*!` 마커와 버전 숫자만 지우고 안의 코드는 그대로 남긴다 — 뒤에
      // 오는 진짜 SQL이 항상 단어 경계로 시작해야 `\bdrop\s` 같은 검사가
      // 버전 숫자와 들러붙어(`50000DROP`) 깨지지 않는다. 닫는 `*/`는
      // 코드에 그대로 남지만 키워드가 아니므로 판정에 영향을 주지 않는다.
      const versioned = /^\/\*!\d*/.exec(sql.slice(i))
      if (versioned !== null) {
        blank(versioned[0].length)
        i += versioned[0].length
        continue
      }

      const end = sql.indexOf('*/', i + 2)
      // 닫히지 않은 블록 주석은 끝까지 주석으로 본다. 코드로 되돌리면
      // 그 안의 키워드가 살아난다.
      const stop = end === -1 ? sql.length : end + 2
      blank(stop - i)
      i = stop
      continue
    }

    const ch = sql[i]

    if (ch === "'" || ch === '"') {
      let j = i + 1
      while (j < sql.length) {
        if (sql[j] === ch) {
          // 같은 따옴표 두 번은 이스케이프다 ('it''s'). 여기서 문자열이
          // 끝났다고 보면 뒤의 코드가 리터럴로, 리터럴이 코드로 뒤바뀐다.
          if (sql[j + 1] === ch) {
            j += 2
            continue
          }
          j += 1
          break
        }
        if (sql[j] === '\\') {
          j += 2
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
      const stop = end === -1 ? sql.length : end + tag.length
      blank(stop - i)
      i = stop
      continue
    }

    out.push(ch ?? '')
    i += 1
  }

  return out.join('')
}

/**
 * 문장을 세미콜론으로 나눈다. 주석·리터럴 안의 세미콜론은 무시한다.
 *
 * 원문을 그대로 자르되, **자를 위치는 마스킹된 사본에서 찾는다** — 그래야
 * 반환값이 실행 가능한 원문으로 남으면서도 리터럴 안의 세미콜론에 속지 않는다.
 */
export function splitStatements(sql: string): string[] {
  const masked = stripCommentsAndLiterals(sql)
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
function classifySingleStatement(raw: string): StatementClassification {
  const masked = stripCommentsAndLiterals(raw).trim()
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

/**
 * 문장을 분류한다. 엔진 독립적인 공통 층이며, 드라이버의 `classify`가 엔진
 * 고유 판정을 더한다. **둘 중 하나라도 read가 아니면 쓰기로 취급한다.**
 *
 * 확신할 수 없으면 항상 `'unknown'`이다. 오탐(읽기를 쓰기로 판정)은 사용자가
 * 승인 한 번 더 누르는 불편이지만, 미탐(쓰기를 읽기로 판정)은 AI가 승인 없이
 * 데이터를 지우는 사고다. 애매하면 언제나 미탐 쪽을 피한다.
 */
export function classifyStatement(sql: string): StatementClassification {
  const statements = splitStatements(sql)

  if (statements.length === 0) return 'unknown'

  if (statements.length > 1) {
    // 다중 문장은 단일 문장으로 확신할 수 없다 — AI 경로는 이를 거부한다.
    // 다만 그중 하나라도 명백한 쓰기라면(예: 세미콜론 뒤 주석에 숨긴
    // DROP) 'unknown'으로 완화하지 않고 'write'를 그대로 보고한다.
    // 미탐(쓰기를 놓치는 것)이 사고이므로, 다중 문장이라는 이유로 이미
    // 확실한 쓰기 신호를 뭉갤 이유가 없다.
    const hasWrite = statements.some((part) => classifySingleStatement(part) === 'write')
    return hasWrite ? 'write' : 'unknown'
  }

  return classifySingleStatement(statements[0] ?? '')
}
