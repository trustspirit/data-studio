import { describe, expect, it } from 'vitest'
import {
  LEXICON_ENGINE_COVERAGE,
  classifyStatement,
  splitStatements,
  stripCommentsAndLiterals,
} from '@main/core/execution/StatementClassifier'
import { ENGINE_IS_SQL, ENGINE_IDS, SQL_ENGINE_IDS } from '@shared/types/connection'

describe('stripCommentsAndLiterals', () => {
  it('줄 주석을 제거한다', () => {
    expect(stripCommentsAndLiterals('SELECT 1 -- DROP TABLE x')).not.toMatch(/DROP/i)
  })

  it('블록 주석을 제거한다', () => {
    expect(stripCommentsAndLiterals('SELECT /* DROP TABLE x */ 1')).not.toMatch(/DROP/i)
  })

  it('중첩되지 않은 블록 주석 안의 세미콜론도 제거한다', () => {
    expect(stripCommentsAndLiterals('SELECT 1 /* ; DROP TABLE x */')).not.toMatch(/;/)
  })

  it('문자열 리터럴 안의 키워드를 지운다 (오탐 방지)', () => {
    // 이건 읽기다. 리터럴 안의 DELETE를 키워드로 읽으면 정상 쿼리가 막힌다.
    expect(stripCommentsAndLiterals("SELECT 'DELETE FROM x'")).not.toMatch(/DELETE/i)
  })

  it('이스케이프된 따옴표를 문자열의 끝으로 착각하지 않는다', () => {
    // 여기서 리터럴이 끝났다고 잘못 판단하면 뒤의 DROP이 코드로 보인다.
    const stripped = stripCommentsAndLiterals("SELECT 'it''s ok; DROP TABLE x'")

    expect(stripped).not.toMatch(/DROP/i)
  })

  it('줄 주석이 \\r로만 끝나도 그 뒤의 코드를 지우지 않는다', () => {
    // 어드버서리얼 케이스: `\n`만 찾으면 옛 Mac 스타일 개행(\r만 있고 \n은
    // 없는 경우) 다음에 오는 코드까지 전부 주석으로 착각해 지워버린다.
    const stripped = stripCommentsAndLiterals('SELECT 1 -- comment\rDROP TABLE x')

    expect(stripped).toMatch(/DROP/i)
  })

  it('달러 인용 블록을 제거한다', () => {
    const stripped = stripCommentsAndLiterals('SELECT $tag$ DELETE FROM x $tag$')

    expect(stripped).not.toMatch(/DELETE/i)
  })

  it('닫히지 않은 문자열은 끝까지 리터럴로 본다', () => {
    // 닫히지 않았는데 코드로 되돌리면 그 안의 키워드가 살아난다.
    expect(stripCommentsAndLiterals("SELECT 'unterminated DROP")).not.toMatch(/DROP/i)
  })

  it('닫히지 않은 블록 주석은 끝까지 주석으로 본다', () => {
    // 안전하지 않은 방향의 분기: 코드로 되돌리면 그 안의 DROP이 살아나는
    // 게 아니라, 반대로 여기서 주석을 일찍 끊으면 뒤의 키워드가 사라진다.
    // 어느 쪽이든 이 분기는 지금까지 테스트로 고정되어 있지 않았다.
    expect(stripCommentsAndLiterals('SELECT 1 /* unterminated DROP TABLE x')).not.toMatch(/DROP/i)
  })

  it('닫히지 않은 달러 인용은 끝까지 리터럴로 본다', () => {
    // 위와 같은 이유로 고정한다.
    expect(stripCommentsAndLiterals('SELECT $$ unterminated DROP TABLE x')).not.toMatch(/DROP/i)
  })

  it('마스킹 결과는 언제나 입력과 길이가 같다', () => {
    // splitStatements가 마스킹된 사본의 인덱스를 원문에 그대로 대응시킨다.
    // 길이가 어긋나면 문장 경계가 밀려 엉뚱한 곳에서 잘린다. 특히 문자열
    // 끝의 백슬래시에서 인덱스가 입력 길이를 넘어가는 것이 알려진 함정이다.
    const adversarial = [
      "SELECT 'a\\",
      "'\\",
      '"\\',
      "';\\",
      'SELECT 1 /* unterminated',
      'SELECT $$ unterminated',
      "SELECT 'a''",
      'SELECT 1 /*!50000',
      "SELECT 1 /*!'*/",
      '--',
      '-- x\r',
      "\\'",
      "'a\\\\",
      '/*',
      '/*!',
      '$$',
      '$tag$',
    ]

    // 두 해석 모두에서 성립해야 한다. 백슬래시 이스케이프 분기는 MySQL
    // 해석에서만 실행되고, 인덱스가 넘치는 것도 바로 그 분기다.
    for (const sql of adversarial) {
      expect(stripCommentsAndLiterals(sql, false)).toHaveLength(sql.length)
      expect(stripCommentsAndLiterals(sql, true)).toHaveLength(sql.length)
    }
  })
})

describe('splitStatements', () => {
  it('세미콜론으로 나눈다', () => {
    expect(splitStatements('SELECT 1; SELECT 2')).toHaveLength(2)
  })

  it('마지막 세미콜론은 빈 문장을 만들지 않는다', () => {
    expect(splitStatements('SELECT 1;')).toHaveLength(1)
  })

  it('문자열 안의 세미콜론으로는 나누지 않는다', () => {
    expect(splitStatements("SELECT 'a;b'")).toHaveLength(1)
  })

  it('주석 안의 세미콜론으로는 나누지 않는다', () => {
    expect(splitStatements('SELECT 1 /* ; */')).toHaveLength(1)
  })
})

describe('classifyStatement', () => {
  it('단순 SELECT는 읽기다', () => {
    expect(classifyStatement('SELECT * FROM users')).toBe('read')
  })

  it('대소문자와 앞 공백에 무관하다', () => {
    expect(classifyStatement('\n\t  select 1')).toBe('read')
  })

  it('UPDATE/DELETE/INSERT/DROP은 쓰기다', () => {
    for (const sql of [
      'UPDATE users SET a = 1',
      'DELETE FROM users',
      'INSERT INTO users VALUES (1)',
      'DROP TABLE users',
      'TRUNCATE users',
      'ALTER TABLE users ADD COLUMN a int',
      'CREATE TABLE t (a int)',
      'GRANT SELECT ON users TO bob',
    ]) {
      expect(classifyStatement(sql)).toBe('write')
    }
  })

  it('주석에 숨긴 다중 문장을 쓰기로 잡는다', () => {
    // 스펙 §4.2 우회 케이스.
    expect(classifyStatement('SELECT 1; /* */ DROP TABLE x')).toBe('write')
  })

  it('CTE 안의 쓰기를 잡는다', () => {
    // 스펙 §4.2 우회 케이스. 문장은 WITH로 시작하지만 DELETE를 수행한다.
    expect(
      classifyStatement('WITH d AS (DELETE FROM x RETURNING *) SELECT * FROM d'),
    ).toBe('write')
  })

  it('읽기만 하는 CTE는 읽기다 (오탐 방지)', () => {
    expect(classifyStatement('WITH t AS (SELECT 1) SELECT * FROM t')).toBe('read')
  })

  it('다중 문장은 전부 읽기여도 unknown이다', () => {
    // AI 경로는 다중 문장 자체를 거부한다(스펙 §4.2 4층). 여기서는 단일
    // 문장이 아님을 상위에 알리는 것으로 충분하다.
    expect(classifyStatement('SELECT 1; SELECT 2')).toBe('unknown')
  })

  it('함수 호출은 unknown이다', () => {
    // SELECT drop_everything() 한 줄로 구문 분석 기반 방어가 뚫린다.
    // 부작용을 정적으로 판정할 수 없으므로 확신하지 않는다.
    expect(classifyStatement('SELECT drop_everything()')).toBe('unknown')
    expect(classifyStatement('CALL do_something()')).toBe('unknown')
  })

  it('빈 문장은 unknown이다', () => {
    expect(classifyStatement('')).toBe('unknown')
    expect(classifyStatement('  -- 주석뿐')).toBe('unknown')
  })

  it('EXPLAIN은 읽기, EXPLAIN ANALYZE는 쓰기다', () => {
    // 스펙: EXPLAIN ANALYZE는 쿼리를 실제로 실행한다.
    expect(classifyStatement('EXPLAIN SELECT 1')).toBe('read')
    expect(classifyStatement('EXPLAIN ANALYZE SELECT 1')).toBe('write')
    expect(classifyStatement('EXPLAIN (ANALYZE true) SELECT 1')).toBe('write')
  })

  it('리터럴 안의 쓰기 키워드에 속지 않는다 (오탐 방지)', () => {
    expect(classifyStatement("SELECT 'DROP TABLE x' AS msg")).toBe('read')
  })

  it('모르는 선두 키워드는 unknown이다', () => {
    expect(classifyStatement('VACUUM users')).toBe('unknown')
  })

  it('MySQL 버전 조건부 주석(/*! ... */) 안의 쓰기를 잡는다', () => {
    // 어드버서리얼 케이스: /*! ... */ 와 /*!50000 ... */ 는 다른 엔진에는
    // 평범한 블록 주석이지만 MySQL은 안의 SQL을 실제로 실행한다. 이걸
    // 일반 주석처럼 지우면 그 안에 숨긴 DROP이 통째로 사라져 미탐이 된다.
    expect(classifyStatement('SELECT 1/*!DROP TABLE x*/')).toBe('write')
    // 버전 숫자가 키워드에 바로 붙어도(공백 없이) 잡아야 한다 — 숫자와
    // 키워드가 들러붙어 단어 경계 검사가 깨지는 것이 흔한 우회 지점이다.
    expect(classifyStatement('SELECT 1/*!50000DROP TABLE x*/')).toBe('write')
    expect(classifyStatement('SELECT 1/*!50000 DROP TABLE x*/')).toBe('write')
  })

  it('MySQL 버전 조건부 주석이 읽기만 담고 있으면 읽기다 (오탐 방지)', () => {
    expect(classifyStatement('SELECT 1/*! , 2 */')).toBe('read')
  })

  it('버전 조건부 주석 안의 여는 토큰이 닫는 */ 밖으로 새지 않는다', () => {
    // 어드버서리얼 케이스(회귀): /*! 마커만 지우고 본문을 코드로 되돌리면
    // 본문 안의 주석·따옴표 여는 토큰이 마스킹 상태를 닫는 `*/` 바깥으로
    // 흘려보내, 그 뒤의 `; DROP TABLE x`를 통째로 삼켜 버린다.
    // /*!...*/ 는 MySQL에서만 실행되고 다른 엔진에는 평범한 주석이므로
    // **두 해석의 합집합**을 취해야 한다.
    expect(classifyStatement('SELECT 1 /*!-- */; DROP TABLE x')).toBe('write')
    expect(classifyStatement("SELECT 1 /*!' */; DROP TABLE x")).toBe('write')
    expect(classifyStatement('SELECT 1 /*!"*/; DROP TABLE x')).toBe('write')
    expect(classifyStatement('SELECT 1 /*!$$*/; DROP TABLE x')).toBe('write')
    expect(classifyStatement("SELECT 1 /*!50000'*/; DROP TABLE x")).toBe('write')
  })

  it('백슬래시를 이스케이프로 단정하지 않는다 (표준 SQL 해석)', () => {
    // PostgreSQL은 9.1부터 standard_conforming_strings=on이 기본이고,
    // SQL Server와 Oracle은 백슬래시 이스케이프를 지원한 적이 없다.
    // 거기서는 `\`가 평범한 문자라 리터럴이 다음 따옴표에서 닫히고,
    // 그 뒤의 `; DROP`은 진짜 코드다.
    expect(classifyStatement("SELECT 'a\\'; DROP TABLE x")).toBe('write')
    // 윈도우 경로는 공격이 아니라 있을 법한 리터럴이다.
    expect(classifyStatement("SELECT 'C:\\'; DROP TABLE x")).toBe('write')
    expect(classifyStatement("SELECT 'a\\' ; TRUNCATE t")).toBe('write')
  })

  it('MySQL 백슬래시 해석에서만 드러나는 쓰기도 잡는다', () => {
    // 반대 방향: 여기서는 표준 해석이 `'a\'`에서 리터럴을 끊고 `b`를 코드로
    // 본 뒤 `'; DROP TABLE x`를 닫히지 않은 리터럴로 삼켜 버린다.
    // MySQL 해석에서만 `; DROP`이 코드로 드러난다. 어느 해석도 다른 쪽을
    // 포함하지 않으므로 둘 다 돌려야 한다.
    expect(classifyStatement("SELECT 'a\\'b'; DROP TABLE x")).toBe('write')
  })

  it('평범한 SELECT의 키워드 뒤 괄호를 함수 호출로 오인하지 않는다', () => {
    // 오탐 방지: unknown은 "사용자가 승인해야 함"을 뜻하므로, 여기서
    // 오인하면 일상적인 SELECT마다 승인을 받아야 한다.
    expect(classifyStatement('SELECT id, name FROM users WHERE id IN (1,2,3)')).toBe('read')
    expect(classifyStatement('SELECT * FROM t WHERE (a=1 AND b=2)')).toBe('read')
    expect(classifyStatement('SELECT * FROM t WHERE a IN (SELECT b FROM u)')).toBe('read')
    expect(classifyStatement('SELECT a FROM t ORDER BY (a)')).toBe('read')
  })

  it('부작용 없는 내장 함수는 read다 (허용 목록)', () => {
    // 결정 번복: 예전에는 전부 unknown이었다. 분석 코퍼스의 39%가 승인
    // 대기에 걸렸는데, 그 unknown이 지키는 것은 거의 없었다 — 모르는 이름은
    // count를 알아보든 말든 unknown이고, 함수의 부작용은 2층의 read-only
    // 트랜잭션이 실제로 막는다. (§ PURE_BUILTIN_FUNCTIONS)
    expect(classifyStatement('SELECT * FROM t WHERE created_at > now()')).toBe('read')
    expect(classifyStatement('SELECT a FROM t GROUP BY a HAVING count(*) > 1')).toBe('read')
    expect(classifyStatement('SELECT sum(x) FROM t')).toBe('read')
  })

  it('인용된 식별자로 감싼 함수 호출도 unknown이다', () => {
    // 어드버서리얼 케이스: 함수 이름을 따옴표로 감싸면 이름이 마스킹으로
    // 지워지거나(`"..."`) 닫는 인용 부호가 단어 경계 검사를 막아
    // (`` `...` ``, `[...]`) 호출 검사를 통째로 빠져나간다.
    // SELECT drop_everything() 과 똑같은 호출이다.
    expect(classifyStatement('SELECT "drop_everything"()')).toBe('unknown')
    expect(classifyStatement('SELECT `drop_all`()')).toBe('unknown')
    expect(classifyStatement('SELECT [drop_all]()')).toBe('unknown')
    // 인용된 식별자 자체는 오탐을 만들지 않아야 한다.
    expect(classifyStatement('SELECT "col" FROM "users" WHERE "id" IN (1,2)')).toBe('read')
  })

  it('\\r로만 끝나는 줄 주석 뒤에 숨긴 쓰기를 잡는다', () => {
    // 어드버서리얼 케이스: -- 주석이 \n 대신 \r로 끝나면 그 뒤의 DROP이
    // 여전히 주석 밖의 진짜 코드로 보여야 한다.
    expect(classifyStatement('SELECT 1 -- comment\rDROP TABLE x')).toBe('write')
  })
})

// ---------------------------------------------------------------------------
// 방언 어휘 모델 (§ StatementClassifier.ts 최상단 주석)
//
// 아래는 "어떤 엔진에서는 코드이고 다른 엔진에서는 주석/문자열인" 토큰들의
// 목록이다. 각각이 하나의 우회 사례가 아니라 **같은 결함 클래스의 인스턴스**다.
// 새 토큰을 발견하면 여기에 케이스를 추가하고 `LEXICAL_DIALECTS`에 플래그를
// 채우는 것으로 끝나야 한다.
// ---------------------------------------------------------------------------
describe('classifyStatement — 방언이 갈리는 어휘 토큰', () => {
  it('$는 MySQL/SQLite/SQL Server에서 식별자 문자다 (달러 인용이 아니다)', () => {
    // 이 태스크를 촉발한 재발 사례. PostgreSQL에서는 `$b$`가 닫히지 않은 달러
    // 인용이라 뒤를 통째로 삼키지만, MySQL 등에서는 `a$b$c`가 그냥 식별자
    // 하나이고 `; DROP TABLE x`는 진짜 두 번째 문장이다.
    expect(classifyStatement('SELECT a$b$c FROM t; DROP TABLE x')).toBe('write')
    expect(classifyStatement('SELECT a$$b FROM t; DROP TABLE x')).toBe('write')
    // PostgreSQL에서도 앞 문자가 식별자 문자면 달러 인용이 아니다.
    expect(stripCommentsAndLiterals('SELECT a$b$c FROM t; DROP TABLE x')).toMatch(/DROP/i)
    // 토큰 시작 위치의 진짜 달러 인용은 여전히 리터럴이다.
    expect(stripCommentsAndLiterals('SELECT $tag$ DELETE FROM x $tag$')).not.toMatch(/DELETE/i)
    // 토큰 시작 위치에서도 달러 인용이 **없는** 방언 해석이 반드시 필요하다:
    // PostgreSQL에서는 통째로 리터럴이지만 MySQL/SQLite/SQL Server에서는
    // `$tag$`가 식별자고 `;`가 진짜 문장 구분자다.
    expect(classifyStatement('SELECT $tag$; DROP TABLE x$tag$')).toBe('write')
  })

  it('#는 MySQL에서만 줄 주석이다', () => {
    // MySQL 해석에서만 `'`가 주석 처리되어 뒤의 `; DROP`이 코드로 드러난다.
    expect(classifyStatement("SELECT 1 # ' \n ; DROP TABLE x")).toBe('write')
    // 반대 방향: PostgreSQL 해석에서만 `#` 뒤가 코드다.
    expect(classifyStatement('SELECT 1 # ; DROP TABLE x')).toBe('write')
  })

  it('--x는 MySQL에서 주석이 아니다 (뒤에 공백류가 있어야 한다)', () => {
    // PostgreSQL/SQLite/SQL Server는 `--x`도 주석이지만 MySQL은 마이너스 두 개다.
    expect(classifyStatement("SELECT 1 --' \n ; DROP TABLE x")).toBe('write')
    expect(classifyStatement('SELECT 1 --; DROP TABLE x')).toBe('write')
  })

  it('블록 주석은 PostgreSQL/SQL Server에서 중첩된다', () => {
    // 중첩하지 않는 엔진에서는 첫 `*/`에서 주석이 끝나 뒤가 코드다.
    expect(classifyStatement('SELECT 1 /* /* */ ; DROP TABLE x */')).toBe('write')
    // 반대 방향: 중첩하는 엔진에서만 `'`가 주석 안에 갇혀 뒤가 코드로 드러난다.
    expect(classifyStatement("SELECT 1 /* /* */ ' */ ; DROP TABLE x")).toBe('write')
  })

  it('`ident`는 MySQL/SQLite에서만 인용 식별자다', () => {
    expect(classifyStatement('SELECT `a`; DROP TABLE x')).toBe('write')
    // 인용 식별자를 쓰는 평범한 읽기는 그대로 읽기여야 한다 (오탐 방지).
    expect(classifyStatement('select * from `users` where `id` = 1')).toBe('read')
  })

  it('[ident]는 SQL Server/SQLite에서만 인용 식별자다', () => {
    expect(classifyStatement('SELECT [a]; DROP TABLE x')).toBe('write')
    // 대괄호 해석이 **드러내는** 쓰기: SQLite/SQL Server에서는 `[';]`가 식별자라
    // 뒤의 `; DROP`이 코드지만, PostgreSQL/MySQL에서는 `'`가 리터럴을 열어
    // 나머지를 통째로 삼킨다.
    expect(classifyStatement("SELECT [';] FROM t; DROP TABLE x")).toBe('write')
    expect(classifyStatement('SELECT * FROM [dbo].[Users] WHERE [Id] = 1')).toBe('read')
  })

  it("E'...'는 PostgreSQL에서도 백슬래시를 이스케이프로 쓴다", () => {
    expect(classifyStatement("SELECT E'a\\'; DROP TABLE x")).toBe('write')
  })

  it('버전 조건부 주석 안에 다른 방언 토큰을 숨겨도 잡는다', () => {
    // 이미 고쳐진 결함이 새 토큰 위에서 재발하지 않는지 — 이 태스크의 요지.
    for (const sql of [
      'SELECT 1 /*!`*/; DROP TABLE x',
      'SELECT 1 /*![*/; DROP TABLE x',
      'SELECT 1 /*!#*/; DROP TABLE x',
      'SELECT 1 /*!/*!*/; DROP TABLE x',
    ]) {
      expect(classifyStatement(sql)).toBe('write')
    }
  })

  it('닫히지 않은 구분자는 그 방언에서 구문 오류이므로 read라고 단언하지 않는다', () => {
    // 마스커가 닫히지 않은 구분자를 끝까지 삼키면 그 안의 진짜 코드도 함께
    // 사라진다. 어느 쪽으로도 단정할 수 없으니 read는 아니다.
    expect(classifyStatement("SELECT 'unterminated")).toBe('unknown')
    expect(classifyStatement('SELECT `unterminated')).toBe('unknown')
    expect(classifyStatement('SELECT 1 /* unterminated')).toBe('unknown')
    expect(classifyStatement('SELECT $$ unterminated')).toBe('unknown')
    // 확실한 쓰기 신호는 여전히 write로 남는다 (unknown으로 뭉개지 않는다).
    expect(classifyStatement("DROP TABLE x; SELECT 'unterminated")).toBe('write')
  })
})

describe('classifyStatement — 읽기로 시작하지만 쓰기를 하는 구문', () => {
  it('SELECT ... INTO 는 테이블을 만든다 (SQL Server/PostgreSQL)', () => {
    expect(classifyStatement('SELECT * INTO newtbl FROM t')).toBe('write')
  })

  it('SELECT ... INTO OUTFILE/DUMPFILE 은 서버에 파일을 쓴다 (MySQL)', () => {
    expect(classifyStatement("SELECT a INTO OUTFILE '/tmp/p' FROM t")).toBe('write')
    expect(classifyStatement("SELECT a INTO DUMPFILE '/tmp/p' FROM t")).toBe('write')
  })

  it('FOR UPDATE/SHARE 는 잠금을 잡으므로 평범한 읽기가 아니다', () => {
    // read-only 트랜잭션이 거부하고 다른 세션을 블로킹할 수 있다. 데이터를
    // 바꾸지는 않으므로 write는 과하다 — unknown(승인 요구)이 정확하다.
    expect(classifyStatement('SELECT * FROM t FOR UPDATE')).toBe('unknown')
    expect(classifyStatement('SELECT * FROM t FOR SHARE')).toBe('unknown')
    expect(classifyStatement('SELECT * FROM t FOR NO KEY UPDATE')).toBe('unknown')
    expect(classifyStatement('SELECT * FROM t LOCK IN SHARE MODE')).toBe('unknown')
  })

  it('CTE 안에 숨긴 쓰기는 이미 잡혀 있다 (회귀 방지)', () => {
    expect(classifyStatement('WITH d AS (DELETE FROM x RETURNING *) SELECT * FROM d')).toBe('write')
    expect(classifyStatement('WITH d AS (INSERT INTO x VALUES (1) RETURNING *) SELECT * FROM d')).toBe('write')
  })

  it('REPLACE/LOAD/RENAME 은 선두 키워드 또는 INTO 규칙이 잡는다', () => {
    // WRITE_ANYWHERE에 이들을 위한 별도 대안을 추가하지 **않았다** — 아래 셋은
    // 전부 WRITE_HEADS나 INTO 규칙이 이미 잡으므로 추가해도 반증 불가능한
    // 죽은 가드가 된다.
    expect(classifyStatement('WITH d AS (SELECT 1) REPLACE INTO t VALUES (1)')).toBe('write')
    expect(classifyStatement('SELECT 1; LOAD DATA INFILE \'x\' INTO TABLE t')).toBe('write')
    expect(classifyStatement('SELECT 1; RENAME TABLE a TO b')).toBe('write')
  })
})

// ---------------------------------------------------------------------------
// 어휘 표와 엔진 목록의 표류 방지.
//
// 이 파일의 건전성 논증은 "LEXICAL_DIALECTS가 지원하는 모든 SQL 엔진을 담는다"에
// 의존한다. 그 완전성이 사람 눈으로만 지켜지다가 실제로 깨졌다 — mariadb가
// EngineId에는 있는데 표에는 없어(MySQL로 유추) /*M! 미탐이 생겼다.
// 다음번 표류는 리뷰가 아니라 이 테스트가 잡는다.
// ---------------------------------------------------------------------------
describe('어휘 표와 EngineId의 정합성', () => {
  it('모든 SQL 엔진이 최소 한 개의 어휘 항목을 갖는다', () => {
    const covered = new Set(LEXICON_ENGINE_COVERAGE.flat())

    for (const engine of SQL_ENGINE_IDS) {
      expect(covered.has(engine), `${engine}에 대응하는 어휘 항목이 없다`).toBe(true)
    }
  })

  it('SQL 엔진 부분집합은 EngineId에서 파생된다 (손으로 두 번 적지 않는다)', () => {
    // ENGINE_IS_SQL은 Record<EngineId, boolean>을 satisfies 하므로 엔진을
    // 추가하면 컴파일이 깨진다 — 침묵으로 기본값이 정해지지 않는다.
    for (const id of ENGINE_IDS) {
      expect(SQL_ENGINE_IDS.includes(id as never)).toBe(ENGINE_IS_SQL[id])
    }
    expect([...SQL_ENGINE_IDS]).toEqual(['postgres', 'mysql', 'mariadb', 'sqlite'])
  })

  it('비SQL 엔진은 어휘 항목에 나타나지 않는다', () => {
    const covered = new Set<string>(LEXICON_ENGINE_COVERAGE.flat())
    const nonSql = ENGINE_IDS.filter((id) => !ENGINE_IS_SQL[id])

    for (const engine of nonSql) {
      expect(covered.has(engine)).toBe(false)
    }
  })
})

// ---------------------------------------------------------------------------
// MariaDB 전용 실행 주석 `/*M! ... */`.
//
// MariaDB는 EngineId에 있는 1급 엔진인데 "MySQL과 같겠지"라는 유추로 모델링되어
// 어휘 표에 항목이 없었다. MariaDB는 MySQL의 `/*!`도 실행하지만 자기 전용
// `/*M!`도 실행하고, MySQL은 후자를 평범한 주석으로 지나친다.
// 출처: MariaDB KB "Comment Syntax" — /*M! ... */ 및 /*M!###### ... */,
// 대문자 M은 대소문자 구분, MySQL은 미지원.
// ---------------------------------------------------------------------------
describe('classifyStatement — MariaDB 실행 주석 /*M!', () => {
  it('/*M! 안에 숨긴 쓰기를 잡는다 (맨몸·버전·들러붙은 형태 전부)', () => {
    for (const sql of [
      'SELECT 1 /*M! ;DROP TABLE x */',
      'SELECT 1 /*M!100000 ;DROP TABLE x */',
      'SELECT 1 /*M!999999 ;DROP TABLE x */',
      'SELECT 1 /*M! SELECT 1; DROP TABLE x */',
      // 버전 숫자가 키워드에 바로 붙는 형태 — 단어 경계가 깨지는 흔한 우회점.
      'SELECT 1 /*M!100000DROP TABLE x*/',
      'SELECT 1/*M!DROP TABLE x*/',
      'SELECT 1 /*M!100000 TRUNCATE t */',
    ]) {
      expect(classifyStatement(sql), sql).toBe('write')
    }
  })

  it('/*M! 본문이 읽기뿐이면 읽기다 (오탐 방지)', () => {
    expect(classifyStatement('SELECT 1 /*M! , 2 */')).toBe('read')
    expect(classifyStatement('SELECT 1 /*M!100000 , 2 */')).toBe('read')
  })

  it('/*M! 본문의 여는 토큰이 닫는 */ 밖으로 새지 않는다', () => {
    // `/*!` 계열에서 이미 고쳤던 결함이 새 토큰 위에서 재발하지 않는지.
    for (const sql of [
      'SELECT 1 /*M!-- */; DROP TABLE x',
      "SELECT 1 /*M!' */; DROP TABLE x",
      'SELECT 1 /*M!"*/; DROP TABLE x',
      'SELECT 1 /*M!$$*/; DROP TABLE x',
      "SELECT 1 /*M!100000'*/; DROP TABLE x",
    ]) {
      expect(classifyStatement(sql), sql).toBe('write')
    }
  })

  it('/*M! 안에 다른 방언 토큰을 숨겨도 잡는다', () => {
    for (const sql of [
      'SELECT 1 /*M!`*/; DROP TABLE x',
      'SELECT 1 /*M![*/; DROP TABLE x',
      'SELECT 1 /*M!#*/; DROP TABLE x',
      'SELECT 1 /*M!/*M!*/; DROP TABLE x',
      'SELECT 1 /*M!/*!*/; DROP TABLE x',
      'SELECT 1 /*!/*M!*/; DROP TABLE x',
    ]) {
      expect(classifyStatement(sql), sql).toBe('write')
    }
  })

  it('/*M! 안에 중첩된 실행 주석의 쓰기도 잡는다', () => {
    expect(classifyStatement('SELECT 1 /*M!100000 /*!50000 DROP TABLE x */ */')).toBe('write')
  })

  it('MariaDB 두 항목(백슬래시 on/off)이 각각 필요하다', () => {
    // 두 mariadb 항목은 `backslashEscapes`만 다르다. 그 차이가 **드러나는**
    // 입력이 없으면 한쪽은 반증 불가능한 죽은 가드다 — 이 코드베이스의 대표적
    // 결함 유형이므로 각 항목을 개별로 고정한다.
    //
    // 아래 둘 다 `/*M!`이라 MySQL 항목들은 평범한 주석으로 지나친다.
    // 따라서 write 판정은 반드시 mariadb 항목 중 하나에서 나온다.

    // backslashEscapes=true인 `mariadb` 항목에서만 드러난다:
    // `'a\'b'`가 한 개의 문자열로 소비되어야 뒤의 /*M! 이 실행 주석으로 보인다.
    expect(classifyStatement("SELECT 'a\\'b' /*M!;DROP TABLE x*/")).toBe('write')

    // backslashEscapes=false인 `mariadb-no-backslash-escapes` 항목에서만 드러난다:
    // `'a\'`가 거기서 끝나야 /*M! 이 주석 밖의 코드로 보인다. 백슬래시 해석에서는
    // 문자열이 `'b'`의 여는 따옴표까지 이어져 주석을 통째로 삼킨다.
    expect(classifyStatement("SELECT 'a\\' /*M!;DROP TABLE x*/ 'b'")).toBe('write')
  })

  it('닫히지 않은 /*M! 은 read로 단언하지 않는다', () => {
    expect(classifyStatement('SELECT 1 /*M!100000 DROP TABLE x')).toBe('write')
    expect(classifyStatement('SELECT 1 /*M!')).toBe('unknown')
  })
})

// ---------------------------------------------------------------------------
// 내장 함수 허용 목록 (§ PURE_BUILTIN_FUNCTIONS).
// ---------------------------------------------------------------------------
describe('classifyStatement — 부작용 없는 내장 함수 허용 목록', () => {
  it('문서화된 순수 내장 함수는 read다', () => {
    for (const sql of [
      'SELECT count(*) FROM t',
      'SELECT sum(amount), avg(amount), min(a), max(a) FROM t',
      'SELECT upper(name) FROM t',
      'SELECT coalesce(a, b, 0) FROM t',
      'SELECT cast(a AS int) FROM t',
      'SELECT extract(year FROM created_at) FROM t',
      'SELECT date_trunc(\'month\', created_at) FROM t',
      'SELECT round(avg(x), 2) FROM t',
      'SELECT string_agg(name, \',\') FROM t',
      'SELECT a, count(*) FROM t GROUP BY a HAVING count(*) > 1 ORDER BY count(*) DESC',
    ]) {
      expect(classifyStatement(sql), sql).toBe('read')
    }
  })

  it('윈도 함수는 OVER( 때문에 여전히 unknown이다 (알려진 잔여 오탐)', () => {
    // row_number/rank 자체는 허용 목록에 있지만, 윈도 문법의 `OVER (` 가
    // 호출 스캔에 걸린다. `over`는 PostgreSQL에서 인용 없이 사용자 정의 함수
    // 이름이 될 수 있어 NON_CALL_KEYWORDS에서 **의도적으로 빠져 있고**
    // (`SELECT over(1)` → unknown 가드), 파서 없이 윈도절의 `OVER (`와
    // UDF 호출 `over(`를 구별할 수 없다.
    //
    // 그 가드를 약화시키느니 오탐(승인 한 번)을 남기는 쪽을 택했다. 이 테스트는
    // 그 선택을 **명시적으로 고정**해 두어, 나중에 누가 `over`를 제외 목록에
    // 넣으면 여기서 드러나게 한다.
    expect(classifyStatement('SELECT row_number() OVER (ORDER BY a) FROM t')).toBe('unknown')
    expect(classifyStatement('SELECT over(1)')).toBe('unknown')
  })

  it('사용자 정의 함수는 여전히 unknown이다 (회귀 금지)', () => {
    expect(classifyStatement('SELECT drop_everything()')).toBe('unknown')
    expect(classifyStatement('SELECT count(*) FROM t WHERE drop_everything()')).toBe('unknown')
    expect(classifyStatement('SELECT my_agg(x) FROM t')).toBe('unknown')
  })

  it('부작용이 있는 내장 함수는 허용 목록에 없다', () => {
    // 쓰거나, 서버 파일을 읽거나, 자거나, 엔진 고유 부작용이 있는 이름들.
    for (const name of [
      'pg_sleep', 'pg_read_file', 'pg_read_binary_file', 'load_file',
      'sys_exec', 'sys_eval', 'lo_import', 'lo_export', 'dblink',
      'xp_cmdshell', 'setval', 'nextval', 'pg_terminate_backend',
      'pg_logical_emit_message',
    ]) {
      expect(classifyStatement(`SELECT ${name}('x')`), name).toBe('unknown')
    }
  })

  it('키워드이면서 함수이기도 한 이름은 허용 목록에 넣지 않았다', () => {
    // 조건 4 (§ PURE_BUILTIN_FUNCTIONS). 중의성은 엄격한 쪽으로 푼다.
    for (const name of ['left', 'right', 'insert', 'replace']) {
      expect(classifyStatement(`SELECT ${name}(a, 1)`), name).toBe('unknown')
    }
  })

  it('인용된 호출도 같은 허용 목록을 통과한다 (양방향 우회 없음)', () => {
    // 느슨해지는 방향: 인용해도 허용 목록 밖이면 unknown 그대로.
    expect(classifyStatement('SELECT "drop_everything"()')).toBe('unknown')
    expect(classifyStatement('SELECT `drop_all`()')).toBe('unknown')
    expect(classifyStatement('SELECT [drop_all]()')).toBe('unknown')
    // 엄격해지는 방향: 인용한 내장 함수는 인용하지 않은 것과 같게 read.
    expect(classifyStatement('SELECT "count"(*) FROM t')).toBe('read')
    expect(classifyStatement('SELECT `count`(*) FROM t')).toBe('read')
    // 대소문자는 접지 않는다 — 인용 식별자는 대소문자를 보존하므로 "COUNT"는
    // 내장 count가 아니라 별개의 함수다. 엄격한 쪽이라 안전하다.
    expect(classifyStatement('SELECT "COUNT"(*) FROM t')).toBe('unknown')
  })

  it('허용 목록이 쓰기 가드를 약화하지 않는다 (회귀 금지)', () => {
    expect(classifyStatement('SELECT count(*) INTO newtbl FROM t')).toBe('write')
    expect(classifyStatement('SELECT count(*) FROM t; DROP TABLE x')).toBe('write')
    expect(classifyStatement('SELECT count(*) FROM t FOR UPDATE')).toBe('unknown')
    expect(classifyStatement('SELECT count(*) FROM t /*M! ;DROP TABLE x */')).toBe('write')
    expect(classifyStatement('WITH d AS (DELETE FROM x RETURNING *) SELECT count(*) FROM d')).toBe('write')
    expect(classifyStatement('EXPLAIN ANALYZE SELECT count(*) FROM t')).toBe('write')
  })
})

describe('classifyStatement — 키워드 제외 목록의 구멍', () => {
  it('PostgreSQL에서 함수 이름이 될 수 있는 키워드는 제외 목록에 없다', () => {
    // 비예약어는 인용 없이 함수 이름이 될 수 있다. 제외 목록에 넣으면
    // `SELECT delete(1)` 한 줄로 호출 검사가 통째로 뚫린다.
    for (const name of [
      'delete', 'update', 'insert', 'set', 'filter', 'over', 'within',
      'partition', 'recursive', 'of', 'left', 'right',
    ]) {
      expect(classifyStatement(`SELECT ${name}(1)`)).toBe('unknown')
    }
  })

  it('문법상 호출이 아님이 보장되는 키워드는 여전히 read다 (오탐 방지)', () => {
    expect(classifyStatement('SELECT id FROM users WHERE id IN (1,2,3)')).toBe('read')
    expect(classifyStatement('SELECT * FROM t WHERE (a=1 AND b=2)')).toBe('read')
    expect(classifyStatement('SELECT * FROM t WHERE a IN (SELECT b FROM u)')).toBe('read')
    expect(classifyStatement('SELECT a FROM t ORDER BY (a)')).toBe('read')
    expect(classifyStatement('SELECT a FROM t1 FULL OUTER JOIN t2 USING (id)')).toBe('read')
    expect(classifyStatement('SELECT a FROM t WHERE EXISTS (SELECT 1 FROM u)')).toBe('read')
    expect(classifyStatement('SELECT CASE WHEN (a=1) THEN 2 ELSE 3 END FROM t')).toBe('read')
    expect(classifyStatement('SELECT a, b FROM t WHERE (a, b) IN ((1,2),(3,4))')).toBe('read')
    expect(classifyStatement('WITH RECURSIVE r AS (SELECT 1) SELECT * FROM r')).toBe('read')
  })
})
