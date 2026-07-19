import { describe, expect, it } from 'vitest'
import {
  classifyStatement,
  splitStatements,
  stripCommentsAndLiterals,
} from '@main/core/execution/StatementClassifier'

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

  it('내장 함수도 여전히 unknown이다 (허용 목록을 두지 않는다)', () => {
    // 내장 함수 허용 목록은 그 자체가 우회면이 된다 — 동명의 사용자 정의
    // 함수로 가릴 수 있다. 확신할 수 없으면 확신하지 않는다.
    expect(classifyStatement('SELECT * FROM t WHERE created_at > now()')).toBe('unknown')
    expect(classifyStatement('SELECT a FROM t GROUP BY a HAVING count(*) > 1')).toBe('unknown')
    expect(classifyStatement('SELECT sum(x) FROM t')).toBe('unknown')
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
