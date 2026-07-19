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

  it('\\r로만 끝나는 줄 주석 뒤에 숨긴 쓰기를 잡는다', () => {
    // 어드버서리얼 케이스: -- 주석이 \n 대신 \r로 끝나면 그 뒤의 DROP이
    // 여전히 주석 밖의 진짜 코드로 보여야 한다.
    expect(classifyStatement('SELECT 1 -- comment\rDROP TABLE x')).toBe('write')
  })
})
