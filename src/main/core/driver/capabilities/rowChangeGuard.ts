import type { RowChange } from '@shared/types/operation'

/**
 * 편집 한 건이 아무 행에도 닿지 않았으면 실패로 본다.
 *
 * # 막는 것
 *
 * 그리드의 편집은 전부 **한 행을 지목한** 문장이다 — INSERT는 새 행 하나,
 * DELETE는 PK로 한 행. 영향 행이 0이면 "지목한 행이 거기 없다"는 뜻이고 그건
 * 성공이 아니다.
 *
 * 검사하지 않으면 침묵하는 데이터 유실이 된다. 드라이버는 영향 행 수를 합산만
 * 하고 commit했고, 상위(`useTableEditor.save`)는 `kind === 'applied'`만 보고
 * 스테이징을 비웠다. 즉 **0행을 지운 DELETE가 성공으로 보고되고 사용자의 대기 중
 * 편집이 사라졌다.** 이 상태를 실제로 만드는 경로가 있었다: 바이너리 PK를 base64
 * 문자열로 바인딩하던 버그가 정확히 "아무 행도 안 맞지만 에러도 아닌" 문장을
 * 만들었다. 그 버그를 고쳐도 PK가 낡은 경우(다른 세션이 먼저 지운 행)에는 같은
 * 일이 일어나므로, 바인딩 수정과 별개로 이 검사가 필요하다.
 *
 * 던지는 쪽을 고른 이유는 호출부가 전부 트랜잭션 안이라는 것이다 — 예외가
 * 롤백을 타므로 배치 중 하나라도 빗나가면 배치 전체가 반영되지 않는다. 부분
 * 반영을 성공으로 보고하는 것보다 전부 되돌리고 알리는 쪽이 맞다.
 *
 * # `update`를 검사하지 않는 이유
 *
 * 엔진들이 UPDATE의 영향 행 수를 서로 다르게 센다. PostgreSQL과 SQLite는 WHERE에
 * 걸린 행을 세므로 값이 그대로여도 1이지만, MySQL의 `affectedRows`는 **실제로
 * 바뀐** 행을 센다(`CLIENT_FOUND_ROWS` 없이는). 그래서 사용자가 셀을 열었다가
 * 같은 값으로 확정하는 흔한 동작이 MySQL에서만 0이 되고, 여기서 그것까지 실패로
 * 처리하면 정상 편집이 깨진다.
 *
 * 플래그를 켜서 세 엔진을 맞추는 편이 의미상 옳지만, 그건 SQL 편집기가 보여주는
 * `rowsAffected`의 뜻까지 바꾸는 프로토콜 변경이고 살아 있는 MySQL 없이는 검증할
 * 수 없다. 검증하지 못한 변경으로 정상 경로를 위협하는 대신, 지금은 확실한
 * 두 종류만 닫고 이 한계를 적어 둔다. (UPDATE가 0행에 닿는 것도 같은 침묵이므로,
 * 엔진별 규약을 실측한 뒤에 함께 닫아야 한다.)
 *
 * # 1보다 큰 경우
 *
 * 막지 않는다. PK가 유일하지 않은 테이블(PK 없는 테이블에서 조립한 키 등)에서
 * 정상적으로 일어날 수 있다.
 */
export function assertRowTouched(change: RowChange, index: number, affected: number): void {
  if (change.op === 'update') return
  if (affected > 0) return
  throw new Error(
    `change ${index} (${change.op}) matched no rows — the target row no longer exists or the key did not match`,
  )
}
