import type { ColumnOrigin } from '@shared/types/resultSet'

/**
 * 엔진이 보고한 원본 이름을 `ColumnOrigin`으로 옮긴다.
 *
 * MySQL(`orgName`)과 SQLite(`sqlite3_column_origin_name`)는 결과 컬럼이 식이면
 * 원본 이름을 빈 값으로 준다. 즉 빈 값은 "모른다"가 아니라 **"원본 컬럼이
 * 없다"**는 적극적인 보고이므로 `computed`로 옮긴다. 두 엔진이 같은 규약을
 * 쓰므로 판정도 한 곳에 둔다.
 *
 * 출처를 아예 알아낼 수 없었던 경우(예: PostgreSQL에서 카탈로그 조회 실패)는
 * 이 함수를 쓰지 말고 `origin`을 비워 둬야 한다 — 그때의 `computed`는 거짓이다.
 */
export function reportedOrigin(
  table: string | null | undefined,
  column: string | null | undefined,
): ColumnOrigin {
  if (typeof column !== 'string' || column === '') return { kind: 'computed' }
  return { kind: 'column', table: typeof table === 'string' && table !== '' ? table : null, column }
}
