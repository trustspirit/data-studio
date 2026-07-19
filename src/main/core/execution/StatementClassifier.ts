import type { SqlEngineId } from '../../../shared/types/connection'
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
   * 이 읽기가 **어떤 실재 엔진을 대변하는가**.
   *
   * 위 건전성 논증("목록이 지원 엔진을 전부 담으면 미탐이 없다")은 표의
   * **완전성**에 의존하는데, 그 완전성이 지금까지 사람 눈으로만 지켜졌다.
   * 실제로 한 번 깨졌다 — `mariadb`가 `EngineId`에 있는데 표에는 없었고
   * (MySQL과 "같겠지"라고 유추한 결과) `/*M!` 실행 주석 미탐이 18종 생겼다.
   *
   * 그래서 완전성을 **데이터로 표현**한다. 테스트가 `SQL_ENGINE_IDS`의 모든
   * 엔진이 최소 한 항목에 나타나는지 기계적으로 검사하므로, 다음번 표류는
   * 리뷰가 아니라 테스트가 잡는다.
   *
   * 빈 배열은 "지원 엔진은 아니지만 방어적으로 더 보는 읽기"를 뜻한다
   * (아래 `sqlserver` 항목).
   */
  readonly engines: readonly SqlEngineId[]
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
  /**
   * `/*M! ... *\/`(선택적으로 `/*M!100000 ... *\/`) 안의 SQL을 실행하는가?
   *
   * **MariaDB만 그렇다.** MySQL은 `/*M!`을 알지 못해 평범한 블록 주석으로
   * 무시한다 — 즉 이것은 MySQL과 MariaDB가 갈리는 실제 어휘 지점이고,
   * "MariaDB는 MySQL과 같다"는 유추가 틀리는 정확히 그 지점이다.
   * (MariaDB는 호환을 위해 `/*!`도 함께 실행하므로 MariaDB 항목은
   * `versionedComments`도 참이다.)
   */
  readonly mariadbVersionedComments: boolean
}

/**
 * 실재하는 (엔진, 모드) 조합. 위 주석의 건전성 논증이 이 목록의 **완전성**에
 * 의존한다 — 지원 엔진을 늘리면 여기도 늘려야 한다.
 *
 * 의도적으로 `"..."`에 대한 플래그는 두지 않았다. MySQL 기본 모드에서 `"..."`는
 * 문자열 리터럴이고 PostgreSQL/MariaDB/SQLite/SQL Server에서는 인용 식별자다.
 *
 * **주의 — 흔한 오해**: "두 해석이 같은 구간을 소비하므로 읽기를 늘릴 필요가
 * 없다"는 것은 **거짓**이다. 마스커는 문자열 리터럴에서만 `backslashEscapes`를
 * 적용하므로, `\`가 끼면 두 해석의 소비 구간이 실제로 갈린다:
 * `"a\"` 는 MySQL(문자열 해석 + 백슬래시)에서는 `\"`가 이스케이프라 닫히지 않고,
 * 식별자 해석에서는 두 번째 `"`에서 닫힌다. 이 전제로 추론하면 틀린 결론에 이른다.
 *
 * 읽기를 늘리지 않는 **진짜 이유**는 표가 이미 두 경우를 모두 담고 있다는 것이다.
 * `"` 처리에서 갈리는 유일한 변수는 `backslashEscapes`인데, `mysql`(참)과
 * `mysql-no-backslash-escapes`(거짓) 쌍이 그 두 값을 모두 돌리고, 나머지 엔진
 * 항목들도 마찬가지로 양쪽을 덮는다. 따라서 "`\"`가 이스케이프인 읽기"와
 * "아닌 읽기"가 이미 각각 평가되며, 별도의 `"`-식별자 플래그는 새로운 소비
 * 구간을 만들어내지 못한다. 남는 실질 차이는 "그 안의 이름이 함수 이름일 수
 * 있는가"뿐이고, 그것은 마스킹이 아니라 `QUOTED_CALL_LIKE`가 **원문**을 훑어서
 * 처리한다.
 *
 * (이 전제가 깨지는 순간 — 예컨대 식별자 인용에만 적용되는 플래그가 새로 생기면
 * — 위 논증도 함께 무효가 되므로 그때는 읽기를 늘려야 한다.)
 */
const LEXICAL_DIALECTS: readonly DialectLexicon[] = [
  {
    name: 'postgres',
    engines: ['postgres'],
    backslashEscapes: false,
    dollarQuoting: true,
    backtickIdentifiers: false,
    bracketIdentifiers: false,
    hashLineComment: false,
    lineCommentRequiresSpace: false,
    nestedBlockComments: true,
    versionedComments: false,
    mariadbVersionedComments: false,
  },
  {
    // standard_conforming_strings=off 이거나 `E'...'` 이스케이프 문자열.
    // PostgreSQL에서 `\`가 이스케이프로 동작하는 실재 모드다.
    name: 'postgres-escape-strings',
    engines: ['postgres'],
    backslashEscapes: true,
    dollarQuoting: true,
    backtickIdentifiers: false,
    bracketIdentifiers: false,
    hashLineComment: false,
    lineCommentRequiresSpace: false,
    nestedBlockComments: true,
    versionedComments: false,
    mariadbVersionedComments: false,
  },
  {
    name: 'mysql',
    engines: ['mysql'],
    backslashEscapes: true,
    dollarQuoting: false,
    backtickIdentifiers: true,
    bracketIdentifiers: false,
    hashLineComment: true,
    lineCommentRequiresSpace: true,
    nestedBlockComments: false,
    versionedComments: true,
    mariadbVersionedComments: false,
  },
  {
    // sql_mode=NO_BACKSLASH_ESCAPES. 실재하는 MySQL 모드다.
    name: 'mysql-no-backslash-escapes',
    engines: ['mysql'],
    backslashEscapes: false,
    dollarQuoting: false,
    backtickIdentifiers: true,
    bracketIdentifiers: false,
    hashLineComment: true,
    lineCommentRequiresSpace: true,
    nestedBlockComments: false,
    versionedComments: true,
    mariadbVersionedComments: false,
  },
  {
    // MariaDB는 "MySQL과 같다"가 **아니다**. `/*M! ... */`는 MariaDB에서만
    // 실행되고 MySQL은 평범한 주석으로 지나친다. 그래서 별도 항목이다.
    name: 'mariadb',
    engines: ['mariadb'],
    backslashEscapes: true,
    dollarQuoting: false,
    backtickIdentifiers: true,
    bracketIdentifiers: false,
    hashLineComment: true,
    lineCommentRequiresSpace: true,
    nestedBlockComments: false,
    versionedComments: true,
    mariadbVersionedComments: true,
  },
  {
    // sql_mode=NO_BACKSLASH_ESCAPES 인 MariaDB.
    name: 'mariadb-no-backslash-escapes',
    engines: ['mariadb'],
    backslashEscapes: false,
    dollarQuoting: false,
    backtickIdentifiers: true,
    bracketIdentifiers: false,
    hashLineComment: true,
    lineCommentRequiresSpace: true,
    nestedBlockComments: false,
    versionedComments: true,
    mariadbVersionedComments: true,
  },
  {
    name: 'sqlite',
    engines: ['sqlite'],
    backslashEscapes: false,
    dollarQuoting: false,
    backtickIdentifiers: true,
    bracketIdentifiers: true,
    hashLineComment: false,
    lineCommentRequiresSpace: false,
    nestedBlockComments: false,
    versionedComments: false,
    mariadbVersionedComments: false,
  },
  {
    // **지원 엔진이 아니다** (`EngineId`에 `sqlserver`는 없다). 그럼에도 남겨
    // 두는 이유: 이 층은 붙여 넣은 임의의 SQL을 본다. T-SQL로 작성된 텍스트가
    // 들어올 수 있고, 최엄격 규칙에서 읽기를 하나 더 보는 비용은 "여기서만
    // 코드로 보이는 구간이 있으면 승인을 요구한다"는 안전한 방향의 오탐뿐이다.
    // 실제로 이 읽기만이 드러내는 케이스가 테스트에 있다(중첩 블록 주석 +
    // 대괄호 식별자 조합). 유지 판단이며, 지원 엔진 목록과 헷갈리지 않도록
    // `engines`를 빈 배열로 둔다.
    name: 'sqlserver',
    engines: [],
    backslashEscapes: false,
    dollarQuoting: false,
    backtickIdentifiers: false,
    bracketIdentifiers: true,
    hashLineComment: false,
    lineCommentRequiresSpace: false,
    nestedBlockComments: true,
    versionedComments: false,
    mariadbVersionedComments: false,
  },
]

/** 커버리지 테스트용. 로직에 쓰이지 않는다 (§ DialectLexicon.engines). */
export const LEXICON_ENGINE_COVERAGE: readonly (readonly SqlEngineId[])[] =
  LEXICAL_DIALECTS.map((d) => d.engines)

const POSTGRES_LEXICON: DialectLexicon = LEXICAL_DIALECTS[0] ?? {
  name: 'postgres',
  engines: ['postgres'],
  backslashEscapes: false,
  dollarQuoting: true,
  backtickIdentifiers: false,
  bracketIdentifiers: false,
  hashLineComment: false,
  lineCommentRequiresSpace: false,
  nestedBlockComments: true,
  versionedComments: false,
  mariadbVersionedComments: false,
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

/**
 * 실행되는 버전 조건부 주석의 여는 마커.
 *
 * `\d*`가 버전 숫자를 삼키므로 `/*!`(맨몸)과 `/*!50000`(버전 지정) 둘 다,
 * 그리고 숫자가 키워드에 바로 붙은 `/*!50000DROP` 형태까지 본문 시작을 정확히
 * 집는다. 버전 숫자의 **값은 보지 않는다** — 접속한 서버 버전을 알 수 없으니
 * "실행될 수 있다"를 가정하는 것이 최엄격 규칙이다.
 */
const VERSIONED_OPENER = /^\/\*!\d*/
/** MariaDB용. `/*!`에 더해 MariaDB 전용 `/*M!`(예: `/*M!100000`)도 실행된다. */
const VERSIONED_OPENER_MARIADB = /^\/\*M?!\d*/

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
      //
      // MariaDB는 여기에 더해 `/*M!...*/`(자기 전용 마커)도 실행하고 MySQL은
      // 그것을 모른 채 지나친다. 그래서 여는 마커 패턴만 방언에서 고른다 —
      // 새 분기가 아니라 §방언 어휘 모델이 요구하는 "플래그 하나 + 삼항 하나"다.
      if (d.versionedComments) {
        const opener = d.mariadbVersionedComments ? VERSIONED_OPENER_MARIADB : VERSIONED_OPENER
        const versioned = opener.exec(sql.slice(i, stop))
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
 * # 읽기로 시작하지만 쓰기/부작용을 수행하는 구문
 *
 * `WRITE_ANYWHERE`와 선두 키워드 분석은 "머리가 읽기면 읽기"라는 가정 위에 있다.
 * 그 가정이 깨지는 구문들을 **하나의 표**로 모은다. 여기도 §방언 어휘 모델과
 * 같은 원칙이다 — 새 구문을 발견하면 표에 줄을 추가할 뿐 분기를 늘리지 않는다.
 *
 * 마스킹된 단일 문장에 대해 검사하므로, 리터럴·주석 안의 같은 단어에는 반응하지
 * 않는다.
 */
const READ_HEADED_SIDE_EFFECTS: readonly {
  readonly pattern: RegExp
  readonly verdict: StatementClassification
  readonly why: string
}[] = [
  {
    // 읽기 머리 뒤의 `INTO`는 어느 방언에서든 부작용을 뜻한다:
    //   - `SELECT ... INTO newtbl`      — SQL Server·PostgreSQL에서 **테이블을 만든다**
    //   - `SELECT ... INTO OUTFILE 'f'` — MySQL에서 **서버 파일시스템에 쓴다**
    //   - `SELECT ... INTO DUMPFILE 'f'` — 같음
    //   - `SELECT ... INTO @var`        — MySQL 변수 대입. 이것만은 쓰기가 아니지만
    //     최엄격 규칙상 한 엔진에서라도 쓰기면 쓰기다.
    // OUTFILE/DUMPFILE을 위한 별도 규칙은 **의도적으로 두지 않았다** — 이 규칙이
    // 정확히 같은 입력을 잡으므로 어떤 테스트로도 구별할 수 없고, 반증 불가능한
    // 가드는 이 코드베이스의 대표적 결함 유형이다.
    pattern: /\binto\b/i,
    verdict: 'write',
    why: 'SELECT ... INTO creates a table, writes a server file, or assigns a variable',
  },
  {
    // 행 잠금을 잡는다. 데이터를 바꾸지는 않으므로 `write`는 과하지만,
    // PostgreSQL의 read-only 트랜잭션은 이것을 **거부**하고, 다른 세션을
    // 블로킹하거나 데드락을 만들 수 있으며, 실무에서 이 구문은 거의 언제나
    // 곧이어 UPDATE를 하기 위한 것이다. 평범한 읽기라고 단언할 수 없다.
    // → `unknown`(사용자 승인 요구)이 정확한 답이다.
    pattern: /\bfor\s+(?:update|share|key\s+share|no\s+key\s+update)\b/i,
    verdict: 'unknown',
    why: 'SELECT ... FOR UPDATE/SHARE takes locks and is rejected by read-only transactions',
  },
  {
    // MySQL의 같은 것.
    pattern: /\block\s+in\s+share\s+mode\b/i,
    verdict: 'unknown',
    why: 'MySQL SELECT ... LOCK IN SHARE MODE takes locks',
  },
]

/**
 * `(` 바로 앞에 붙어도 **함수 호출이 아님이 문법으로 보장되는** 토큰들.
 *
 * 판정 기준은 딱 하나다: **PostgreSQL에서 인용 없이 함수 이름이 될 수 없는가.**
 * (예약어이거나 `type_func_name_reserved`면 그렇다. 인용해서 함수를 만들면
 * `QUOTED_CALL_LIKE`가 원문에서 잡는다.) 이 기준을 통과하지 못하는 단어를
 * 여기 넣으면 `SELECT <그단어>(1)`이 곧바로 `read`가 되어 우회면이 된다.
 *
 * 그래서 다음은 **일부러 빠져 있다**:
 *   - `delete` `update` `insert` `set` `filter` `over` `within` `partition`
 *     `recursive` `of` — PostgreSQL에서 전부 인용 없이 함수 이름이 될 수 있고
 *     (`insert`는 MySQL 내장 문자열 함수이기도 하다), 실제로 `SELECT delete(1)`
 *     같은 입력이 `read`로 새어 나갔다.
 *   - `left` `right` — PostgreSQL/MySQL의 실재 내장 함수다. `LEFT JOIN`에는
 *     괄호가 붙지 않으므로 제외해도 오탐이 늘지 않는다.
 *
 * 여기에 **내장 함수는 넣지 않는다**. 내장 함수는 별도의
 * `PURE_BUILTIN_FUNCTIONS` 허용 목록이 다룬다 — 두 목록은 판정 기준이 다르므로
 * (여기는 "문법상 호출일 수 없는가", 저기는 "부작용이 없는 문서화된 내장인가")
 * 섞지 않는다.
 */
const NON_CALL_KEYWORDS = new Set([
  'in', 'and', 'or', 'not', 'where', 'on', 'values', 'case', 'when',
  'then', 'else', 'end', 'between', 'like', 'ilike', 'exists', 'from', 'select',
  'by', 'having', 'group', 'order', 'union', 'intersect', 'except', 'all',
  'any', 'some', 'is', 'null', 'as', 'join', 'inner', 'outer',
  'full', 'cross', 'lateral', 'using', 'limit', 'offset', 'fetch', 'returning',
  'distinct', 'with', 'into', 'table', 'asc', 'desc', 'for',
])

/**
 * # 부작용이 없는 문서화된 내장 함수 허용 목록
 *
 * ## 왜 허용 목록을 두는가 (이전 결정의 번복)
 *
 * 원래 이 파일은 내장 함수도 전부 `unknown`으로 두었다. "확신할 수 없으면
 * 확신하지 않는다"는 원칙에 충실해 보였지만, 측정해 보니 **현실적인 분석
 * 쿼리 코퍼스의 39%가 승인 대기**에 걸렸다. 분석이란 곧 집계이고, 집계는
 * `count(*)`·`sum`·`avg`·`date_trunc` 없이는 쓰이지 않기 때문이다.
 *
 * 그리고 그 `unknown`은 **실제로 지키는 것이 거의 없었다**. 논거 두 가지:
 *
 * 1. **보호 범위가 비어 있다.** 이 검사가 막고 싶은 것은 모르는 함수의 부작용인데,
 *    모르는 이름은 `count`를 알아보든 말든 여전히 `unknown`이다. `count`를
 *    `unknown`으로 두는 것이 추가로 막는 입력은 "이름이 `count`인 사용자 정의
 *    함수"뿐이고, 그것은 아래 §반론에서 따로 다룬다.
 * 2. **부작용은 여기가 아니라 2층이 막는다.** 실행 경로는 DB 수준의 read-only
 *    트랜잭션 안에서 돈다. 함수가 무엇을 하든 쓰기는 거기서 거부된다. 이 층은
 *    read-only 트랜잭션이 **막지 못하는 것**(다중 문장, 명백한 DDL/DML, 서버
 *    파일 쓰기, 잠금)에 집중하는 편이 실효가 크다.
 *
 * ## 목록에 이름을 추가하려면 (미래의 유지보수자에게)
 *
 * 아래 네 조건을 **전부** 만족해야 한다. 하나라도 확인되지 않으면 넣지 않는다.
 *
 * 1. **문서화된 내장**이어야 한다. 지원 엔진(§ SQL_ENGINE_IDS)의 공식 문서에
 *    있는 이름만. 확장(extension)이 제공하는 이름은 안 된다.
 * 2. **부작용이 없어야 한다.** 쓰기·서버 파일 읽기/쓰기·네트워크·대기(sleep)·
 *    세션 상태 변경 중 어느 것도 하지 않아야 한다. 그래서 다음은 **의도적으로
 *    빠져 있다**: `pg_sleep`(대기), `pg_read_file`/`load_file`(서버 파일 읽기),
 *    `lo_import`/`lo_export`(라지오브젝트 I/O), `dblink`(네트워크),
 *    `sys_exec`/`xp_cmdshell`(셸 실행), `setval`(시퀀스 변경),
 *    `pg_terminate_backend`(세션 종료).
 * 3. **모든 엔진에서 순수해야 한다.** 한 엔진에서 순수하고 다른 엔진에서
 *    부작용이 있으면 **부작용 쪽으로 판정한다** — 이 파일 전체를 지배하는
 *    최엄격 원칙과 같다. 이 층은 어느 엔진으로 갈지 모른 채 판정하기 때문이다.
 * 4. **SQL 키워드와 동명이 아니어야 한다.** `left`/`right`/`insert`/`replace`
 *    처럼 키워드이면서 함수이기도 한 이름은 넣지 않는다. 넣으면 `NON_CALL_KEYWORDS`
 *    쪽 가드와 판정이 얽혀 어느 쪽이 무엇을 막는지 테스트로 분리할 수 없게 되고
 *    (이 코드베이스의 대표적 결함 유형), 키워드/함수 중의성이 `read` 쪽으로
 *    풀리게 된다. 그래서 `SELECT left(a,1)`은 지금도 `unknown`이다.
 *
 * ## 반론: 동명의 사용자 정의 함수로 가릴 수 있지 않은가
 *
 * 가릴 수 있다. `count`라는 이름의 UDF를 만들어 스키마 검색 경로 앞에 두면
 * `SELECT count(x)`가 그 UDF를 부른다. 다만 (a) 그것은 서버에 이미 쓰기 권한을
 * 가진 자가 미리 심어 둔 경우에만 성립하고, (b) 그 UDF의 부작용도 결국 2층의
 * read-only 트랜잭션이 막으며, (c) 이 위험은 허용 목록 유무와 무관하게
 * `NON_CALL_KEYWORDS`에도 이미 존재한다. 받아들일 수 있는 잔여 위험으로 본다.
 */
const PURE_BUILTIN_FUNCTIONS = new Set([
  // 집계 (ANSI + 널리 구현된 확장)
  'count', 'sum', 'avg', 'min', 'max', 'total',
  'stddev', 'stddev_pop', 'stddev_samp', 'variance', 'var_pop', 'var_samp',
  'corr', 'covar_pop', 'covar_samp',
  'bool_and', 'bool_or', 'every', 'bit_and', 'bit_or', 'bit_xor',
  'string_agg', 'array_agg', 'group_concat', 'listagg',
  'percentile_cont', 'percentile_disc', 'mode',
  // 윈도 함수 (ANSI)
  'row_number', 'rank', 'dense_rank', 'percent_rank', 'cume_dist', 'ntile',
  'lag', 'lead', 'first_value', 'last_value', 'nth_value',
  // 조건·널 처리 (ANSI)
  'coalesce', 'nullif', 'ifnull', 'nvl', 'greatest', 'least',
  // 타입 변환 (ANSI 문법이지만 스캐너에는 호출로 보인다)
  'cast', 'extract', 'overlay',
  // 문자열 (ANSI + 널리 구현된 확장)
  'upper', 'lower', 'initcap', 'length', 'char_length', 'character_length',
  'octet_length', 'bit_length', 'substr', 'substring', 'trim', 'ltrim', 'rtrim',
  'btrim', 'lpad', 'rpad', 'concat', 'concat_ws', 'reverse', 'repeat',
  'position', 'strpos', 'instr', 'split_part', 'ascii', 'chr', 'translate',
  'md5', 'quote_literal', 'quote_ident',
  // 수치 (ANSI + 널리 구현된 확장)
  'abs', 'ceil', 'ceiling', 'floor', 'round', 'trunc', 'sign', 'mod',
  'power', 'sqrt', 'cbrt', 'exp', 'ln', 'log', 'log10', 'log2',
  'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2', 'degrees', 'radians', 'pi',
  // 날짜·시간 (ANSI + 널리 구현된 확장). 세션 시각을 읽을 뿐 바꾸지 않는다.
  'now', 'current_date', 'current_time', 'current_timestamp',
  'localtime', 'localtimestamp', 'age',
  'date_trunc', 'date_part', 'datediff', 'timestampdiff',
  'to_char', 'to_date', 'to_timestamp', 'to_number',
  'date_format', 'str_to_date', 'from_unixtime', 'unix_timestamp',
  'year', 'month', 'day', 'hour', 'minute', 'second', 'quarter', 'week',
  'dayofweek', 'dayofyear', 'weekday', 'monthname', 'dayname',
  'julianday', 'strftime',
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
 *
 * 허용 목록(`PURE_BUILTIN_FUNCTIONS`)은 여기서도 **똑같이** 적용되어야 한다.
 * 그러지 않으면 인용이 우회면이 된다: `"count"()`가 `count()`보다 엄격하거나
 * 느슨해질 이유가 없다.
 *
 * 다만 **대소문자를 접지 않는다**. 인용 식별자는 대소문자를 보존하고
 * PostgreSQL의 내장 함수 이름은 소문자이므로, `"COUNT"`는 내장 `count`가 아니라
 * `COUNT`라는 별개의 (사용자 정의) 함수다. 그래서 인용형은 **정확히 소문자로
 * 적힌 허용 목록 이름**만 통과시킨다. 인용을 씌워 느슨해지는 방향이 없다.
 */
const QUOTED_CALL_LIKE = /(?:"([^"]*)"|`([^`]*)`|\[([^\]]*)\])\s*\(/g

/** 인용 안에서 꺼낸 이름. 세 대안 중 매치된 하나. */
function quotedName(match: RegExpMatchArray): string | undefined {
  return match[1] ?? match[2] ?? match[3]
}

function hasCallLike(raw: string, masked: string): boolean {
  for (const match of raw.matchAll(QUOTED_CALL_LIKE)) {
    const name = quotedName(match)
    // 대소문자를 접지 않는다 (§ QUOTED_CALL_LIKE).
    if (name !== undefined && !PURE_BUILTIN_FUNCTIONS.has(name)) return true
  }

  for (const match of masked.matchAll(CALL_LIKE_SCAN)) {
    const name = match[1]?.toLowerCase()
    if (name === undefined) continue
    if (NON_CALL_KEYWORDS.has(name)) continue
    if (PURE_BUILTIN_FUNCTIONS.has(name)) continue
    return true
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

  const isReadHead = READ_HEADS.has(head) || head === 'with'
  if (!isReadHead) return 'unknown'

  // 머리가 읽기여도 부작용을 수행하는 구문이 있다 (§ READ_HEADED_SIDE_EFFECTS).
  let verdict: StatementClassification = 'read'
  for (const rule of READ_HEADED_SIDE_EFFECTS) {
    if (rule.pattern.test(masked)) verdict = stricter(verdict, rule.verdict)
  }
  if (verdict === 'write') return 'write'

  if (head === 'with') {
    // CTE 본문의 쓰기는 WRITE_ANYWHERE가 이미 잡았다. 여기까지 왔으면
    // 읽기 전용 CTE다.
    return verdict
  }

  // SELECT drop_everything() — 함수의 부작용은 정적으로 알 수 없다.
  return hasCallLike(raw, masked) ? 'unknown' : verdict
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
