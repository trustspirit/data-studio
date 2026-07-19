import { describe, expect, it } from 'vitest'
import { classifyStatement } from '@main/core/execution/StatementClassifier'

/**
 * # 분류기 퍼즈 하니스 — **커밋되는 파일**
 *
 * 앞선 두 라운드의 퍼즈는 일회용 스크립트였다. 그래서 (a) "40만 건에서 미탐 0건"
 * 이라는 가장 강한 근거가 **감사 불가능**했고, (b) 토큰 풀에 `/*M!`이 없다는
 * 사실을 아무도 볼 수 없었다 — 두 번 다 MariaDB 실행 주석을 그대로 놓쳤다.
 * 그래서 이번에는 하니스와 오라클을 테스트로 커밋한다.
 *
 * ## 오라클은 구현을 다시 부르지 않는다
 *
 * 아래 `oracleMask`는 `StatementClassifier`를 임포트하지 않는다. 벤더 문서에서
 * 읽은 방언 규칙표(`ORACLE_DIALECTS`)로부터 **독립적으로 다시 작성한 렉서**다.
 * 구현과 같은 함수를 부르면 같은 버그를 공유해 아무것도 검출하지 못한다.
 *
 * ## 검사하는 성질 (미탐만 본다)
 *
 * 어떤 실재 방언에서든 최상위 `;` 뒤에 쓰기 키워드가 **코드로** 살아 있으면,
 * `classifyStatement`는 `read`를 반환해서는 안 된다.
 * (`write`인지 `unknown`인지는 묻지 않는다 — 둘 다 승인을 요구하므로 안전하다.)
 * 오탐은 여기서 보지 않는다. 별도의 코퍼스 테스트가 담당한다.
 */

interface OracleDialect {
  readonly name: string
  readonly backslashEscapes: boolean
  readonly dollarQuoting: boolean
  readonly backtickIdentifiers: boolean
  readonly bracketIdentifiers: boolean
  readonly hashLineComment: boolean
  readonly lineCommentRequiresSpace: boolean
  readonly nestedBlockComments: boolean
  /** 실행되는 조건부 주석 여는 마커들. 빈 배열이면 전부 평범한 주석이다. */
  readonly executableOpeners: readonly RegExp[]
}

const MYSQL_OPENER = /^\/\*!\d*/
const MARIADB_OPENERS = [/^\/\*!\d*/, /^\/\*M!\d*/] as const

/**
 * 벤더 문서에서 직접 옮긴 표. 구현의 `LEXICAL_DIALECTS`를 베끼지 않았다.
 * - PostgreSQL 17 §4.1: 블록 주석 중첩, `--` 뒤 공백 불필요, scs=on(+`E''`),
 *   `$tag$` 달러 인용, `$`는 식별자 문자, `#`은 주석 아님, 백틱/대괄호 아님.
 * - MySQL 8.4 "Comment Syntax": `#` 주석, `--` 뒤 공백 필요, 중첩 없음,
 *   `/*!` 실행, `/*M!` **미지원**.
 * - MariaDB KB "Comment Syntax": `/*!`와 `/*M!` 둘 다 실행, 대문자 M 고정.
 * - SQLite: `#` 토큰 오류, `--` 공백 불필요, 중첩 없음, 백틱·대괄호 식별자,
 *   백슬래시는 평범한 문자 (sqlite3 CLI 실측).
 */
const ORACLE_DIALECTS: readonly OracleDialect[] = [
  { name: 'postgres', backslashEscapes: false, dollarQuoting: true, backtickIdentifiers: false, bracketIdentifiers: false, hashLineComment: false, lineCommentRequiresSpace: false, nestedBlockComments: true, executableOpeners: [] },
  { name: 'postgres-escape', backslashEscapes: true, dollarQuoting: true, backtickIdentifiers: false, bracketIdentifiers: false, hashLineComment: false, lineCommentRequiresSpace: false, nestedBlockComments: true, executableOpeners: [] },
  { name: 'mysql', backslashEscapes: true, dollarQuoting: false, backtickIdentifiers: true, bracketIdentifiers: false, hashLineComment: true, lineCommentRequiresSpace: true, nestedBlockComments: false, executableOpeners: [MYSQL_OPENER] },
  { name: 'mysql-nbe', backslashEscapes: false, dollarQuoting: false, backtickIdentifiers: true, bracketIdentifiers: false, hashLineComment: true, lineCommentRequiresSpace: true, nestedBlockComments: false, executableOpeners: [MYSQL_OPENER] },
  { name: 'mariadb', backslashEscapes: true, dollarQuoting: false, backtickIdentifiers: true, bracketIdentifiers: false, hashLineComment: true, lineCommentRequiresSpace: true, nestedBlockComments: false, executableOpeners: MARIADB_OPENERS },
  { name: 'mariadb-nbe', backslashEscapes: false, dollarQuoting: false, backtickIdentifiers: true, bracketIdentifiers: false, hashLineComment: true, lineCommentRequiresSpace: true, nestedBlockComments: false, executableOpeners: MARIADB_OPENERS },
  { name: 'sqlite', backslashEscapes: false, dollarQuoting: false, backtickIdentifiers: true, bracketIdentifiers: true, hashLineComment: false, lineCommentRequiresSpace: false, nestedBlockComments: false, executableOpeners: [] },
]

interface OracleMask {
  /** 입력과 길이가 같은 마스킹 사본. 주석·리터럴 자리는 공백. */
  readonly masked: string
  /** 실행되는 조건부 주석의 본문들. */
  readonly bodies: readonly string[]
}

/** 독립 렉서. 구현을 부르지 않는다. */
function oracleMask(sql: string, d: OracleDialect): OracleMask {
  const out: string[] = []
  const bodies: string[] = []
  let i = 0

  const skipToLineEnd = (): void => {
    let j = i
    while (j < sql.length && sql[j] !== '\n' && sql[j] !== '\r') j += 1
    out.push(' '.repeat(j - i))
    i = j
  }

  while (i < sql.length) {
    const ch = sql[i]
    const two = sql.slice(i, i + 2)

    if (two === '--') {
      const next = sql[i + 2]
      const isComment = !d.lineCommentRequiresSpace || next === undefined || /\s/.test(next)
      if (isComment) {
        skipToLineEnd()
        continue
      }
    }

    if (d.hashLineComment && ch === '#') {
      skipToLineEnd()
      continue
    }

    if (two === '/*') {
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
      const stop = end === -1 ? sql.length : end + 2
      const bodyEnd = end === -1 ? sql.length : end
      for (const opener of d.executableOpeners) {
        const m = opener.exec(sql.slice(i, stop))
        if (m !== null) {
          const bodyStart = i + m[0].length
          if (bodyEnd > bodyStart) bodies.push(sql.slice(bodyStart, bodyEnd))
          break
        }
      }
      out.push(' '.repeat(stop - i))
      i = stop
      continue
    }

    if (ch === "'" || ch === '"') {
      let j = i + 1
      while (j < sql.length) {
        if (sql[j] === ch) {
          if (sql[j + 1] === ch) {
            j += 2
            continue
          }
          j += 1
          break
        }
        if (d.backslashEscapes && sql[j] === '\\') {
          j = Math.min(j + 2, sql.length)
          continue
        }
        j += 1
      }
      out.push(' '.repeat(j - i))
      i = j
      continue
    }

    if ((d.backtickIdentifiers && ch === '`') || (d.bracketIdentifiers && ch === '[')) {
      const close = ch === '`' ? '`' : ']'
      let j = i + 1
      while (j < sql.length) {
        if (sql[j] === close) {
          if (sql[j + 1] === close) {
            j += 2
            continue
          }
          j += 1
          break
        }
        j += 1
      }
      out.push(' '.repeat(j - i))
      i = j
      continue
    }

    if (d.dollarQuoting && ch === '$') {
      const prev = i > 0 ? sql[i - 1] : undefined
      const startsToken = prev === undefined || !/[A-Za-z0-9_$]/.test(prev)
      const m = startsToken ? /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i)) : null
      if (m !== null) {
        const tag = m[0]
        const end = sql.indexOf(tag, i + tag.length)
        const stop = end === -1 ? sql.length : end + tag.length
        out.push(' '.repeat(stop - i))
        i = stop
        continue
      }
    }

    out.push(ch ?? '')
    i += 1
  }

  return { masked: out.join(''), bodies }
}

const WRITE_AFTER_SEMICOLON = /^\s*(drop|truncate|delete|insert|update|create|alter)\b/i

/** 이 방언에서 최상위 `;` 뒤에 쓰기가 코드로 드러나는가. */
function oracleExposesWrite(sql: string, d: OracleDialect, depth = 0): boolean {
  if (depth > 4) return false
  const { masked, bodies } = oracleMask(sql, d)

  for (let i = 0; i < masked.length; i += 1) {
    if (masked[i] !== ';') continue
    if (WRITE_AFTER_SEMICOLON.test(masked.slice(i + 1))) return true
  }
  for (const body of bodies) {
    if (WRITE_AFTER_SEMICOLON.test(body)) return true
    if (oracleExposesWrite(body, d, depth + 1)) return true
  }
  return false
}

function exposedUnderAnyDialect(sql: string): boolean {
  return ORACLE_DIALECTS.some((d) => oracleExposesWrite(sql, d))
}

/** 결정론적 PRNG (mulberry32). 실패를 재현할 수 있어야 한다. */
function makeRng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * 토큰 풀. **방언이 갈리는 토큰 전부**가 들어 있어야 한다 — 이전 퍼즈가
 * `/*M!`을 빠뜨려 MariaDB 미탐을 두 번 놓쳤다. 새 방언 토큰을 모델링하면
 * 여기에도 반드시 추가할 것.
 */
const TOKENS = [
  // 주석·실행 주석 여는 마커
  '/*', '*/', '/*!', '/*!50000', '/*M!', '/*M!100000', '/*M!999999',
  '--', '--x', '#', '\n', '\r',
  // 인용·이스케이프
  "'", '"', '`', '[', ']', '\\', "''", '\\\\',
  // 달러 인용
  '$$', '$tag$', 'a$b$c',
  // 구조
  ';', ' ', ',', '(', ')', '1', 'x',
  // 허용 목록에 있는 순수 내장 함수 (퍼즈가 read 경로를 실제로 밟게 한다)
  'count(*)', 'sum(x)', 'avg(x)', 'upper(a)', 'coalesce(a,b)',
  'cast(a AS int)', 'date_trunc(\'day\',t)', 'max(a)', 'min(a)', 'extract(year FROM t)',
  // 허용 목록에 **없는** 이름 — 부작용 있는 내장과 사용자 정의 함수
  'pg_sleep(1)', 'pg_read_file(\'/etc/passwd\')', 'load_file(\'x\')',
  'sys_exec(\'rm\')', 'lo_import(\'x\')', 'dblink(\'x\')', 'xp_cmdshell(\'dir\')',
  'drop_everything()', 'my_udf(1)',
  // 키워드
  'SELECT', 'FROM', 't', 'DROP', 'TABLE', 'WHERE',
] as const

function randomToken(rng: () => number): string {
  const idx = Math.floor(rng() * TOKENS.length)
  return TOKENS[idx] ?? 'x'
}

function generate(rng: () => number): string {
  const shape = Math.floor(rng() * 3)
  const n = 1 + Math.floor(rng() * 8)
  const junk = Array.from({ length: n }, () => randomToken(rng)).join('')

  // 템플릿 1: 식별자 중간에 토큰을 끼운다 (달러 인용 계열에 직접 도달).
  if (shape === 0) return `SELECT a${junk}b FROM t; DROP TABLE x`
  // 템플릿 2: SELECT 뒤 잡음 + 두 번째 문장.
  if (shape === 1) return `SELECT 1 ${junk}; DROP TABLE x`
  // 템플릿 3: 잡음 안에 세미콜론과 쓰기가 함께 섞인다.
  return `SELECT ${junk} FROM t`
}

describe('classifyStatement — 퍼즈 (독립 오라클)', () => {
  it('어떤 실재 방언에서든 드러나는 쓰기를 read로 분류하지 않는다', () => {
    const rng = makeRng(0x5eed_1234)
    const iterations = 50_000
    let exposed = 0
    const failures: string[] = []

    for (let n = 0; n < iterations; n += 1) {
      const sql = generate(rng)
      if (!exposedUnderAnyDialect(sql)) continue
      exposed += 1
      if (classifyStatement(sql) === 'read' && failures.length < 20) {
        failures.push(sql)
      }
    }

    // 하니스에 이빨이 있는지 먼저 확인한다. 노출 건수가 0이면 위 단언은
    // 공허하게 통과한다 — 이전 라운드가 정확히 그렇게 실패했다.
    expect(exposed).toBeGreaterThan(iterations / 20)
    expect(failures).toEqual([])
  })

  it('오라클이 /*M! 계열을 실제로 MariaDB에서만 노출한다 (오라클 자체 검증)', () => {
    // 오라클이 틀리면 위 테스트가 조용히 무력해진다. 오라클을 직접 고정한다.
    const sql = 'SELECT 1 /*M!100000 ;DROP TABLE x */'
    const byName = (name: string): OracleDialect | undefined =>
      ORACLE_DIALECTS.find((d) => d.name === name)

    const mariadb = byName('mariadb')
    const mysql = byName('mysql')
    const postgres = byName('postgres')

    expect(mariadb).toBeDefined()
    expect(mysql).toBeDefined()
    expect(postgres).toBeDefined()
    if (mariadb === undefined || mysql === undefined || postgres === undefined) return

    expect(oracleExposesWrite(sql, mariadb)).toBe(true)
    expect(oracleExposesWrite(sql, mysql)).toBe(false)
    expect(oracleExposesWrite(sql, postgres)).toBe(false)
    expect(classifyStatement(sql)).not.toBe('read')
  })

  it('토큰 풀이 방언 분기 토큰을 빠뜨리지 않는다', () => {
    // 이전 퍼즈의 실패 원인을 회귀 테스트로 고정한다.
    for (const required of ['/*M!', '/*!', '$tag$', '#', '--x', '`', '[', '\\']) {
      expect(TOKENS.includes(required as never), `토큰 풀에 ${required}가 없다`).toBe(true)
    }
  })
})

/**
 * # 오탐 부담 측정 — 현실적인 분석 코퍼스
 *
 * 내장 함수 허용 목록 도입 전에는 이 28개 중 11개(39%)가 `unknown`이었다.
 * 그 수치가 결정 번복의 근거였으므로, 회귀하지 않도록 테스트로 고정한다.
 */
const ANALYTICAL_CORPUS = [
  'SELECT * FROM users',
  'SELECT id, name FROM users WHERE id IN (1,2,3)',
  'SELECT count(*) FROM orders',
  'SELECT count(*) AS n FROM orders WHERE status = \'paid\'',
  'SELECT sum(amount) FROM orders',
  'SELECT avg(amount), max(amount), min(amount) FROM orders',
  'SELECT customer_id, count(*) FROM orders GROUP BY customer_id',
  'SELECT customer_id, sum(amount) AS total FROM orders GROUP BY customer_id HAVING sum(amount) > 100',
  'SELECT upper(name) FROM customers',
  'SELECT coalesce(nickname, name) FROM customers',
  'SELECT cast(amount AS int) FROM orders',
  'SELECT extract(year FROM created_at) AS y, count(*) FROM orders GROUP BY 1',
  'SELECT date_trunc(\'month\', created_at) AS m, sum(amount) FROM orders GROUP BY 1 ORDER BY 1',
  'SELECT o.id, c.name FROM orders o JOIN customers c ON c.id = o.customer_id',
  'SELECT * FROM orders ORDER BY created_at DESC LIMIT 100',
  'SELECT * FROM orders LIMIT 50 OFFSET 100',
  'WITH recent AS (SELECT * FROM orders WHERE created_at > now()) SELECT count(*) FROM recent',
  'WITH RECURSIVE r AS (SELECT 1 AS n) SELECT * FROM r',
  'SELECT a FROM t1 UNION SELECT a FROM t2',
  'SELECT a FROM t1 INTERSECT SELECT a FROM t2',
  'SELECT * FROM t WHERE EXISTS (SELECT 1 FROM u WHERE u.id = t.id)',
  'SELECT round(avg(amount), 2) FROM orders',
  'SELECT length(name), substr(name, 1, 3) FROM customers',
  'SELECT string_agg(name, \',\') FROM customers',
  'SELECT greatest(a, b), least(a, b) FROM t',
  'SHOW TABLES',
  'DESCRIBE users',
  'EXPLAIN SELECT count(*) FROM orders',
] as const

describe('오탐 부담 — 분석 코퍼스', () => {
  it('허용 목록 도입 후 승인이 필요한 쿼리가 없다', () => {
    const needsApproval = ANALYTICAL_CORPUS.filter((sql) => classifyStatement(sql) !== 'read')

    expect(needsApproval).toEqual([])
  })
})
