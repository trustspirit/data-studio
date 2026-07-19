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
