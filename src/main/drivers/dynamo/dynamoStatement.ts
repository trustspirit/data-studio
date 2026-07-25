/**
 * PartiQL 문장이 읽기 전용(SELECT)인가.
 *
 * PartiQL for DynamoDB의 DML은 SELECT/INSERT/UPDATE/DELETE 넷뿐이다. 선행 주석과
 * 공백을 걷어낸 첫 키워드가 정확히 `SELECT`일 때만 true. Mongo의
 * `isReadOnlyPipeline`과 같은 역할을, PartiQL 문법에 대해 수행한다.
 *
 * `\b` 경계를 써서 `SELECTED` 같은 접두 일치를 거부한다.
 */
export function isReadOnlyStatement(statement: string): boolean {
  const stripped = statement
    .replace(/\/\*[\s\S]*?\*\//g, ' ') // 블록 주석
    .replace(/--[^\n]*/g, ' ') // 라인 주석
    .trimStart()
  return /^select\b/i.test(stripped)
}
