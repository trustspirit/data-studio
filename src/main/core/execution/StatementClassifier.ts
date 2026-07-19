import type { StatementClassification } from '../driver/capabilities/SqlCapability'

/**
 * # 방언 어휘 모델 (이 파일의 핵심 불변식)
 *
 * 이 층은 **엔진 독립적**이다. 하나의 입력 문자열이 어느 엔진에 가서 실행될지
 * 모른 채로 읽기/쓰기를 판정해야 한다. 문제는 SQL의 **어휘 구조 자체가 엔진마다
 * 다르다**는 것이다. 어떤 엔진에서는 코드인 토큰이 다른 엔진에서는 주석이거나
 * 문자열이다. `/*!...*\/`(MySQL에서만 실행), `\`(MySQL에서만 이스케이프),
 * `$tag$`(PostgreSQL에서만 인용), `#`(MySQL에서만 줄 주석) …
 *
 * 과거 이 파일은 그런 토큰이 하나 발견될 때마다 **특례 분기**를 하나 추가하는
 * 방식으로 고쳐졌다. 네 번 연속으로 어드버서리얼 리뷰가 새 우회를 찾아냈고,
 * 마지막 것은 이미 고친 결함이 **다른 토큰 위에서 그대로 재발**한 것이었다
 * (`\` → `$tag$`). 원인은 토큰이 아니라 모델이었다.
 *
 * ## 불변식 — 미래의 유지보수자가 반드시 지켜야 할 것
 *
 * **방언 차이는 코드가 아니라 데이터다.** 어휘가 갈리는 토큰을 새로 발견하면
 * `DialectLexicon`에 불리언 플래그를 하나 늘리고 `LEXICAL_DIALECTS`의 각 항목에
 * 값을 채우는 것으로 끝나야 한다. **새 분기를 `classifyStatement`에 추가하지
 * 말 것.** 마스커 안에 `if (d.새플래그)` 한 줄이 붙는 것은 괜찮지만, "이 토큰만
 * 특별히 두 번 돌린다" 같은 합집합 로직을 또 만들면 같은 실패가 반복된다.
 *
 * **판정은 모든 읽기(reading)에 대한 최엄격값이다.** 모든 방언이 `read`라고 할
 * 때만 `read`, 하나라도 `write`면 `write`, 나머지는 `unknown`. 백슬래시와 버전
 * 조건부 주석에 이미 쓰이던 합집합 패턴을 전체로 일반화한 것이다.
 *
 * ## 조합 폭발을 어떻게 막는가
 *
 * 플래그가 N개면 교차곱은 2^N개의 읽기다. 지금 N=8이니 256개 — 긴 스크립트에서
 * 감당하기 어렵고, 무엇보다 **의미가 없다**. 2^N 중 대부분은 실재하지 않는
 * 가상의 엔진이기 때문이다.
 *
 * 그래서 교차곱 대신 **실재하는 (엔진, 모드) 조합만** 열거한다. 건전성 논증은
 * 이렇다: 입력 S가 실제로 실행되는 곳은 반드시 실재하는 엔진 E다. `LEXICAL_DIALECTS`
 * 가 앱이 접속할 수 있는 모든 E를 포함하면, E에서 쓰기인 S는 반드시 어떤 읽기에서
 * 쓰기로 보이고 최엄격 규칙이 그것을 채택한다. 실재하지 않는 플래그 조합은
 * 어차피 아무 데서도 실행되지 않으므로 뺀 것이 안전성을 해치지 않는다.
 * (반대로 교차곱을 쓰면 존재하지 않는 엔진 때문에 오탐만 늘어난다.)
 *
 * 새 엔진을 지원하게 되면 여기에 항목을 **추가**해야 한다. 그것이 이 설계가
 * 요구하는 유일한 유지보수 부담이다.
 */
interface DialectLexicon {
  /** 진단·테스트용 이름. 로직에 쓰이지 않는다. */
  readonly name: string
  /**
   * 문자열 리터럴 안에서 `\`가 이스케이프인가?
   * MySQL/MariaDB 기본값은 그렇다(`NO_BACKSLASH_ESCAPES` 미설정).
   * PostgreSQL은 9.1부터 `standard_conforming_strings=on`이 기본이라 아니다
   * (단 `E'...'` 리터럴은 예외 — 아래 `postgres-escape-strings` 항목이 덮는다).
   * SQL Server·SQLite·Oracle은 아니다.
   */
  readonly backslashEscapes: boolean
  /**
   * `$tag$ ... $tag$`가 달러 인용 문자열인가?
   * PostgreSQL만 그렇다. MySQL/SQL Server/SQLite/Oracle에서 `$`는 식별자에
   * 쓸 수 있는 평범한 문자이므로 `SELECT a$b$c FROM t; DROP TABLE x`는
   * **정상적인 두 문장짜리 입력**이다.
   */
  readonly dollarQuoting: boolean
  /** `` `ident` ``가 인용 식별자인가? MySQL/MariaDB/SQLite는 그렇고 PostgreSQL/SQL Server는 아니다. */
  readonly backtickIdentifiers: boolean
  /** `[ident]`가 인용 식별자인가? SQL Server/SQLite는 그렇고 PostgreSQL/MySQL은 아니다. */
  readonly bracketIdentifiers: boolean
  /** `#`가 줄 주석인가? MySQL/MariaDB만 그렇다 (SQLite에서는 토큰 오류). */
  readonly hashLineComment: boolean
  /**
   * `--` 뒤에 공백류가 **있어야** 줄 주석인가?
   * MySQL/MariaDB는 그렇다(`--x`는 주석이 아니라 이항 마이너스 두 개).
   * PostgreSQL/SQLite/SQL Server는 `--x`도 주석이다.
   */
  readonly lineCommentRequiresSpace: boolean
  /** `/* /* *\/ *\/`가 중첩되는가? PostgreSQL·SQL Server는 중첩하고 MySQL·SQLite는 첫 `*\/`에서 끝난다. */
  readonly nestedBlockComments: boolean
  /** `/*! ... *\/` 안의 SQL을 실제로 실행하는가? MySQL/MariaDB만 그렇다. */
  readonly versionedComments: boolean
}

/**
 * 실재하는 (엔진, 모드) 조합. 위 주석의 건전성 논증이 이 목록의 **완전성**에
 * 의존한다 — 지원 엔진을 늘리면 여기도 늘려야 한다.
 *
 * 의도적으로 `"..."`에 대한 플래그는 두지 않았다. MySQL 기본 모드에서 `"..."`는
 * 문자열 리터럴이고 PostgreSQL/SQLite/SQL Server에서는 인용 식별자이지만,
 * **마스킹 관점에서는 두 해석이 정확히 같은 구간을 같은 방식으로 소비한다**
 * (여는 `"`부터 짝이 되는 `"`까지, `""`는 이스케이프, MySQL에서는 `\`도 이스케이프).
 * 실질적 차이는 "그 안의 이름이 함수 이름일 수 있는가"뿐이고 그것은 마스킹이 아니라
 * `QUOTED_CALL_LIKE`가 **원문**을 훑어서 처리한다. 읽기를 하나 늘려도 결과가
 * 달라질 수 없으므로 늘리지 않았다.
 */
const LEXICAL_DIALECTS: readonly DialectLexicon[] = [
  {
    name: 'postgres',
    backslashEscapes: false,
    dollarQuoting: true,
    backtickIdentifiers: false,
    bracketIdentifiers: false,
    hashLineComment: false,
    lineCommentRequiresSpace: false,
    nestedBlockComments: true,
    versionedComments: false,
  },
  {
    // standard_conforming_strings=off 이거나 `E'...'` 이스케이프 문자열.
    // PostgreSQL에서 `\`가 이스케이프로 동작하는 실재 모드다.
    name: 'postgres-escape-strings',
    backslashEscapes: true,
    dollarQuoting: true,
    backtickIdentifiers: false,
    bracketIdentifiers: false,
    hashLineComment: false,
    lineCommentRequiresSpace: false,
    nestedBlockComments: true,
    versionedComments: false,
  },
  {
    name: 'mysql',
    backslashEscapes: true,
    dollarQuoting: false,
    backtickIdentifiers: true,
    bracketIdentifiers: false,
    hashLineComment: true,
    lineCommentRequiresSpace: true,
    nestedBlockComments: false,
    versionedComments: true,
  },
  {
    // sql_mode=NO_BACKSLASH_ESCAPES. 실재하는 MySQL/MariaDB 모드다.
    name: 'mysql-no-backslash-escapes',
    backslashEscapes: false,
    dollarQuoting: false,
    backtickIdentifiers: true,
    bracketIdentifiers: false,
    hashLineComment: true,
    lineCommentRequiresSpace: true,
    nestedBlockComments: false,
    versionedComments: true,
  },
  {
    name: 'sqlite',
    backslashEscapes: false,
    dollarQuoting: false,
    backtickIdentifiers: true,
    bracketIdentifiers: true,
    hashLineComment: false,
    lineCommentRequiresSpace: false,
    nestedBlockComments: false,
    versionedComments: false,
  },
  {
    name: 'sqlserver',
    backslashEscapes: false,
    dollarQuoting: false,
    backtickIdentifiers: false,
    bracketIdentifiers: true,
    hashLineComment: false,
    lineCommentRequiresSpace: false,
    nestedBlockComments: true,
    versionedComments: false,
  },
]

const POSTGRES_LEXICON: DialectLexicon = LEXICAL_DIALECTS[0] ?? {
  name: 'postgres',
  backslashEscapes: false,
  dollarQuoting: true,
  backtickIdentifiers: false,
  bracketIdentifiers: false,
  hashLineComment: false,
  lineCommentRequiresSpace: false,
  nestedBlockComments: true,
  versionedComments: false,
}

const MYSQL_LEXICON: DialectLexicon = LEXICAL_DIALECTS[2] ?? POSTGRES_LEXICON

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
  /**
   * 닫히지 않은 구분자(문자열·주석·인용 식별자·달러 인용)가 입력 끝까지
   * 삼켰는가?
   *
   * 마스커는 닫히지 않은 구분자를 **끝까지 지운다**. 그래야 그 안에 숨긴
   * 키워드가 코드로 되살아나지 않는다. 그런데 같은 동작이 반대로 **진짜
   * 코드를 지워 버리기도** 한다 — `` SELECT `x FROM t; DROP TABLE y `` 에서
   * 닫히지 않은 백틱이 뒤의 `; DROP`을 통째로 삼킨다.
   *
   * 어느 쪽으로도 단정할 수 없다. 다만 확실한 것이 하나 있다: **닫히지 않은
   * 구분자는 그 방언에서 구문 오류다.** 그 방언은 이 입력을 실행하지 못하므로
   * "읽기다"라고 말할 자격이 없다. 그래서 이 플래그가 서면 해당 방언의 판정을
   * `read`에서 `unknown`으로 올린다 (`write`는 그대로 둔다 — 이미 확실한
   * 신호를 뭉갤 이유가 없다).
   */
  readonly unterminated: boolean
}

/** 식별자에 쓰일 수 있는 문자. 달러 인용의 시작 판정에 쓴다. */
const IDENT_CHAR = /[A-Za-z0-9_$-￿]/

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
 * @param d 어느 방언으로 읽을지. 호출자는 `LEXICAL_DIALECTS` **전부**를 돌려
 *   최엄격 결과를 택한다 (§ 방언 어휘 모델).
 */
function maskSql(sql: string, d: DialectLexicon): MaskResult {
  const out: string[] = []
  const versionedBodies: string[] = []
  let i = 0
  let unterminated = false

  const blank = (n: number): void => {
    out.push(' '.repeat(n))
  }

  /** 줄 끝(`\n` 또는 옛 Mac 스타일 `\r`)까지 지운다. */
  const consumeLineComment = (): void => {
    // `\n`만 찾으면 `\r`로만 끝나는 줄에서는 인덱스가 안 나와 문자열
    // 끝까지 전부 주석으로 지워버려, 그 뒤에 있는 진짜 코드(예: 다음
    // "줄"의 DROP)까지 함께 사라지는 미탐이 생긴다.
    const newline = /[\r\n]/.exec(sql.slice(i))
    const stop = newline === null ? sql.length : i + newline.index
    blank(stop - i)
    i = stop
  }

  /** 여는 문자 `open`부터 짝이 되는 `close`까지 지운다. 닫는 문자를 두 번 쓰면 이스케이프. */
  const consumeDelimited = (open: number, close: string): void => {
    let j = open + 1
    let closed = false
    while (j < sql.length) {
      if (sql[j] === close) {
        if (sql[j + 1] === close) {
          j += 2
          continue
        }
        j += 1
        closed = true
        break
      }
      j += 1
    }
    if (!closed) unterminated = true
    blank(j - open)
    i = j
  }

  while (i < sql.length) {
    const two = sql.slice(i, i + 2)

    if (two === '--') {
      // MySQL은 `--` 뒤에 공백류가 와야 주석으로 본다. `--x`는 MySQL에서
      // 코드이고 PostgreSQL/SQLite/SQL Server에서는 주석이다 — 방언이 갈리는
      // 지점이므로 플래그로 다룬다.
      const next = sql[i + 2]
      const isComment =
        !d.lineCommentRequiresSpace || next === undefined || /\s/.test(next)
      if (isComment) {
        consumeLineComment()
        continue
      }
    }

    if (d.hashLineComment && sql[i] === '#') {
      consumeLineComment()
      continue
    }

    if (two === '/*') {
      // 블록 주석은 **언제나** 닫는 `*/`까지를 한 덩어리로 본다.
      // 닫히지 않았으면 끝까지 주석으로 본다 — 코드로 되돌리면 그 안의
      // 키워드가 살아난다.
      //
      // PostgreSQL과 SQL Server는 블록 주석이 **중첩**된다. MySQL과 SQLite는
      // 첫 `*/`에서 끝난다. 그래서 `/* /* */ ; DROP TABLE x */`는 전자에서
      // 전부 주석이고 후자에서는 `; DROP TABLE x */`가 코드다 — 양쪽 다 봐야 한다.
      let depth = 1
      let j = i + 2
      let end = -1
      while (j < sql.length) {
        if (sql.slice(j, j + 2) === '*/') {
          depth -= 1
          if (depth === 0) {
            end = j
            break
          }
          j += 2
          continue
        }
        if (d.nestedBlockComments && sql.slice(j, j + 2) === '/*') {
          depth += 1
          j += 2
          continue
        }
        j += 1
      }
      if (end === -1) unterminated = true
      const stop = end === -1 ? sql.length : end + 2

      // `/*!...*/`(선택적으로 `/*!50000...*/`)는 MySQL의 버전 조건부
      // "주석"이다 — 다른 엔진에는 평범한 블록 주석이지만 MySQL은 안의
      // SQL을 실제로 실행한다. 방언 목록에 MySQL 항목이 있으므로 거기서만
      // 본문을 꺼내면 되고, 주 스트림에서는 언제나 통째로 지운다.
      //
      // 주 스트림에서 지우는 이유: 본문 안의 따옴표나 `--` 같은 여는 토큰이
      // 마스킹 상태를 닫는 `*/` **바깥으로 흘려보내지** 못하게 하기 위해서다.
      // (본문을 그대로 코드로 되돌리면 `SELECT 1 /*!' */; DROP TABLE x`
      // 에서 본문의 `'`가 뒤의 `; DROP`까지 리터럴로 삼켜 미탐이 된다.)
      if (d.versionedComments) {
        const versioned = /^\/\*!\d*/.exec(sql.slice(i, stop))
        if (versioned !== null) {
          const bodyStart = i + versioned[0].length
          const bodyEnd = end === -1 ? sql.length : end
          if (bodyEnd > bodyStart) versionedBodies.push(sql.slice(bodyStart, bodyEnd))
        }
      }

      blank(stop - i)
      i = stop
      continue
    }

    const ch = sql[i]

    if (ch === "'" || ch === '"') {
      let j = i + 1
      let closed = false
      while (j < sql.length) {
        if (sql[j] === ch) {
          // 같은 따옴표 두 번은 이스케이프다 ('it''s').
          //
          // 주의: 이 분기는 **현재 외연적으로 무의미하다(inert)**. 마스킹이
          // 길이만 보존하는 공백을 뱉기 때문에, "닫고 곧바로 다시 연다"와
          // "건너뛰고 계속한다"가 정확히 같은 구간을 같은 길이로 소비한다.
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
          closed = true
          break
        }
        if (d.backslashEscapes && sql[j] === '\\') {
          // 길이 불변식: 문자열 끝의 `\`에서 `j`가 `sql.length`를 넘어가면
          // 소비한 것보다 많은 공백을 뱉는다.
          j = Math.min(j + 2, sql.length)
          continue
        }
        j += 1
      }
      if (!closed) unterminated = true
      blank(j - i)
      i = j
      continue
    }

    if (d.backtickIdentifiers && ch === '`') {
      consumeDelimited(i, '`')
      continue
    }

    if (d.bracketIdentifiers && ch === '[') {
      consumeDelimited(i, ']')
      continue
    }

    if (d.dollarQuoting && ch === '$') {
      // PostgreSQL 달러 인용: $tag$ ... $tag$
      //
      // **앞 문자가 식별자 문자면 달러 인용이 아니다.** PostgreSQL도 `$`를
      // 식별자 문자로 허용하므로 `a$b$c`는 식별자 하나지 인용의 시작이 아니다.
      // 이 검사가 없으면 `SELECT a$b$c FROM t; DROP TABLE x`에서 `$b$`가
      // 닫히지 않은 인용으로 잡혀 뒤의 `; DROP`을 통째로 삼킨다.
      const prev = i > 0 ? sql[i - 1] : undefined
      const startsToken = prev === undefined || !IDENT_CHAR.test(prev)
      const dollar = startsToken
        ? /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i))
        : null
      if (dollar !== null) {
        const tag = dollar[0]
        const end = sql.indexOf(tag, i + tag.length)
        // 닫히지 않은 달러 인용은 끝까지 리터럴로 본다. 코드로 되돌리면
        // 그 안의 키워드가 살아난다.
        if (end === -1) unterminated = true
        const stop = end === -1 ? sql.length : end + tag.length
        blank(stop - i)
        i = stop
        continue
      }
    }

    out.push(ch ?? '')
    i += 1
  }

  return { masked: out.join(''), versionedBodies, unterminated }
}

/**
 * 주석과 문자열 리터럴을 같은 길이의 공백으로 치환한다.
 *
 * 기본값은 PostgreSQL 해석(`\`는 평범한 문자)이다. 분류는
 * `classifyStatement`가 `LEXICAL_DIALECTS` 전부를 돌려 최엄격 결과를 택한다.
 *
 * @param backslashEscapes MySQL처럼 `\`를 문자열 이스케이프로 볼지 여부.
 *   진단·테스트용 편의 인자이며, 두 대표 방언을 고르는 것에 해당한다.
 */
export function stripCommentsAndLiterals(sql: string, backslashEscapes = false): string {
  return maskSql(sql, backslashEscapes ? MYSQL_LEXICON : POSTGRES_LEXICON).masked
}

function splitStatementsWith(sql: string, d: DialectLexicon): string[] {
  const { masked } = maskSql(sql, d)
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
  return splitStatementsWith(sql, POSTGRES_LEXICON)
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
const WRITE_ANYWHERE =
  /\b(insert\s+into|update\s+\w|delete\s+from|merge\s+into|truncate\s|drop\s|alter\s|create\s|grant\s|revoke\s)/i

/**
 * `(` 바로 앞에 붙는 SQL 키워드들. 키워드 뒤의 괄호는 함수 호출이 아니라
 * 문법 구조다 — `IN (1,2,3)`, `WHERE (a=1 AND b=2)`, `GROUP BY (a)` 등.
 *
 * 여기에 **내장 함수는 넣지 않는다**. `count()`, `now()`, `sum()`도
 * `unknown`으로 남는다 — 내장 함수 허용 목록은 그 자체가 우회면이 되고
 * (동명의 사용자 정의 함수로 가릴 수 있다), 이 층의 목적은 확신할 수 없는
 * 것을 확신하지 않는 것이다.
 */
const NON_CALL_KEYWORDS = new Set([
  'in', 'and', 'or', 'not', 'where', 'on', 'values', 'over', 'case', 'when',
  'then', 'else', 'end', 'between', 'like', 'ilike', 'exists', 'from', 'select',
  'by', 'having', 'group', 'order', 'union', 'intersect', 'except', 'all',
  'any', 'some', 'is', 'null', 'as', 'join', 'inner', 'outer', 'left', 'right',
  'full', 'cross', 'lateral', 'using', 'limit', 'offset', 'fetch', 'returning',
  'distinct', 'with', 'recursive', 'partition', 'filter', 'within', 'into',
  'set', 'table', 'insert', 'update', 'delete', 'asc', 'desc', 'for', 'of',
])

/**
 * 함수·프로시저 호출로 보이는 형태를 찾는다. 부작용을 정적으로 판정할 수 없다.
 *
 * `\b<식별자>\s*\(` 를 **전부** 훑고, 그중 하나라도 SQL 키워드가 아니면
 * 호출로 본다. 키워드 뒤의 괄호까지 호출로 세면 `WHERE id IN (1,2,3)` 같은
 * 평범한 SELECT가 전부 `unknown`이 되어 사용자가 매번 승인해야 한다.
 */
const CALL_LIKE_SCAN = /\b([a-z_][a-z0-9_]*)\s*\(/gi

/**
 * **인용된 식별자** 뒤의 괄호. `SELECT "drop_everything"()`처럼 함수 이름을
 * 따옴표로 감싸면 위의 스캔이 놓친다:
 *   - `"..."`(PostgreSQL/표준 식별자 인용)는 마스커가 문자열 리터럴로 보고
 *     공백으로 지워 버려서 마스킹된 사본에는 이름이 남지 않는다.
 *   - `` `...` ``(MySQL)와 `[...]`(SQL Server)는 방언에 따라 마스킹되거나
 *     남는데, 남더라도 `\b\w+\s*\(`의 `\s*`가 닫는 인용 부호를 못 넘어가
 *     매치되지 않는다.
 *
 * 어느 쪽이든 `SELECT drop_everything()`과 똑같은 호출이므로 `unknown`이어야
 * 한다. 그래서 이 스캔만은 **원문**을 본다.
 */
const QUOTED_CALL_LIKE = /(?:"[^"]*"|`[^`]*`|\[[^\]]*\])\s*\(/

function hasCallLike(raw: string, masked: string): boolean {
  if (QUOTED_CALL_LIKE.test(raw)) return true

  for (const match of masked.matchAll(CALL_LIKE_SCAN)) {
    const name = match[1]?.toLowerCase()
    if (name !== undefined && !NON_CALL_KEYWORDS.has(name)) return true
  }
  return false
}

/** `write` > `unknown` > `read` 순으로 더 엄격한 쪽. */
function stricter(
  a: StatementClassification,
  b: StatementClassification,
): StatementClassification {
  if (a === 'write' || b === 'write') return 'write'
  if (a === 'unknown' || b === 'unknown') return 'unknown'
  return 'read'
}

/**
 * 이미 세미콜론으로 나뉜 **단일** 문장 하나를 분류한다. 여러 문장을 다루는
 * 상위 규칙은 `classifyStatement`가 맡는다.
 */
function classifySingleStatement(raw: string, d: DialectLexicon): StatementClassification {
  const result = maskSql(raw, d)

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
    return hasCallLike(raw, masked) ? 'unknown' : 'read'
  }

  return 'unknown'
}

function classifyUnder(sql: string, d: DialectLexicon): StatementClassification {
  // 닫히지 않은 구분자가 있으면 이 방언은 입력을 실행조차 못 한다 — "읽기다"라고
  // 말할 자격이 없다 (§ MaskResult.unterminated). `read`만 `unknown`으로 올린다.
  const floor: StatementClassification = maskSql(sql, d).unterminated ? 'unknown' : 'read'
  const statements = splitStatementsWith(sql, d)

  if (statements.length === 0) return 'unknown'

  if (statements.length > 1) {
    // 다중 문장은 단일 문장으로 확신할 수 없다 — AI 경로는 이를 거부한다.
    // 다만 그중 하나라도 명백한 쓰기라면(예: 세미콜론 뒤 주석에 숨긴
    // DROP) 'unknown'으로 완화하지 않고 'write'를 그대로 보고한다.
    // 미탐(쓰기를 놓치는 것)이 사고이므로, 다중 문장이라는 이유로 이미
    // 확실한 쓰기 신호를 뭉갤 이유가 없다.
    const hasWrite = statements.some((part) => classifySingleStatement(part, d) === 'write')
    return hasWrite ? 'write' : 'unknown'
  }

  return stricter(floor, classifySingleStatement(statements[0] ?? '', d))
}

/**
 * 문장을 분류한다. 엔진 독립적인 공통 층이며, 드라이버의 `classify`가 엔진
 * 고유 판정을 더한다. **둘 중 하나라도 read가 아니면 쓰기로 취급한다.**
 *
 * 확신할 수 없으면 항상 `'unknown'`이다. 오탐(읽기를 쓰기로 판정)은 사용자가
 * 승인 한 번 더 누르는 불편이지만, 미탐(쓰기를 읽기로 판정)은 AI가 승인 없이
 * 데이터를 지우는 사고다. 애매하면 언제나 미탐 쪽을 피한다.
 *
 * **규칙은 하나다: `LEXICAL_DIALECTS`의 모든 읽기를 평가하고 최엄격값을 택한다.**
 * 모두가 `read`라고 할 때만 `read`. 방언별 특례 분기를 여기에 추가하지 말 것
 * (§ 방언 어휘 모델의 불변식).
 */
export function classifyStatement(sql: string): StatementClassification {
  let verdict: StatementClassification = 'read'

  for (const dialect of LEXICAL_DIALECTS) {
    verdict = stricter(verdict, classifyUnder(sql, dialect))
    if (verdict === 'write') return 'write'
  }

  return verdict
}
