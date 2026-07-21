import type { SqlCapability } from '../../core/driver/capabilities/SqlCapability'
import type { ExecutionContext } from '../../core/driver/ExecutionContext'
import type { PageRequest, ResultSet } from '../../../shared/types/resultSet'

/**
 * 읽기 문장을 정책이 정한 스코프에서 실행한다.
 *
 * `readOnlyScope`가 true(AI 경로)면 DB 수준 읽기 전용 트랜잭션 안에서 실행하고
 * 반드시 `end()`한다. false(사용자 경로)면 직접 실행한다. 이 함수가 sql·data
 * 실행기의 **유일한** 읽기 통로이므로, "AI 읽기는 읽기 전용 스코프 안에서만"이라는
 * 불변식이 여기 한 곳에만 존재한다.
 */
export async function executeRead(
  sql: SqlCapability,
  ctx: ExecutionContext,
  sqlText: string,
  page: PageRequest,
  params: readonly unknown[] | undefined,
  readOnlyScope: boolean,
): Promise<ResultSet> {
  if (!readOnlyScope) return sql.execute(ctx, sqlText, page, params)

  if (sql.beginReadOnly === undefined) {
    // 조용히 일반 실행으로 대체하면 AI 읽기 전용 보장이 무너진 채 안전해 보인다.
    throw new Error('driver does not support a read-only scope')
  }

  const scope = await sql.beginReadOnly(ctx)
  try {
    return await scope.execute(ctx, sqlText, page, params)
  } finally {
    await scope.end()
  }
}
