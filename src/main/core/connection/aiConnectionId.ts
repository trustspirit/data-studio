import { DERIVED_CONNECTION_ID_SUFFIX } from '../../../shared/types/connection'

/**
 * AI 읽기 전용 계정의 풀 엔트리 id 규약.
 *
 * `ConnectionConfig.aiReadOnlyUsername`이 설정된 커넥션은 사용자 계정 엔트리
 * (`id`)와 AI 계정 엔트리(`id + '::ai'`) 두 개를 풀에 갖는다. 파생 id 하나로
 * 풀·드라이버 팩토리·실행기가 같은 규약을 공유하므로 풀 자체는 role을 모른다 —
 * 그저 다른 커넥션일 뿐이다.
 *
 * 접미사는 shared에 있다(`DERIVED_CONNECTION_ID_SUFFIX`) — IPC 계약이 renderer
 * 입력에서 같은 문자열을 예약어로 거부해야 하므로 출처가 하나여야 한다.
 * 커넥션 id는 `crypto.randomUUID()`로 생성되고 계약이 이 접미사를 거부하므로
 * 파생 id와 충돌하는 실제 커넥션은 존재할 수 없다.
 */
export const AI_CONNECTION_ID_SUFFIX = DERIVED_CONNECTION_ID_SUFFIX

export function aiConnectionIdOf(connectionId: string): string {
  return `${connectionId}${AI_CONNECTION_ID_SUFFIX}`
}

/** 드라이버 팩토리가 비밀 종류를 고르기 위해 파생 id를 되돌린다. */
export function parseConnectionId(id: string): { readonly baseId: string; readonly isAi: boolean } {
  if (!id.endsWith(AI_CONNECTION_ID_SUFFIX)) return { baseId: id, isAi: false }
  return { baseId: id.slice(0, -AI_CONNECTION_ID_SUFFIX.length), isAi: true }
}
