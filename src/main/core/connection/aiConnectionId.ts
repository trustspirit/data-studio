/**
 * AI 읽기 전용 계정의 풀 엔트리 id 규약.
 *
 * `ConnectionConfig.aiReadOnlyUsername`이 설정된 커넥션은 사용자 계정 엔트리
 * (`id`)와 AI 계정 엔트리(`id + '::ai'`) 두 개를 풀에 갖는다. 파생 id 하나로
 * 풀·드라이버 팩토리·실행기가 같은 규약을 공유하므로 풀 자체는 role을 모른다 —
 * 그저 다른 커넥션일 뿐이다.
 *
 * 커넥션 id는 `crypto.randomUUID()`로 생성되므로 `::ai` 접미사와 충돌하지 않는다.
 */
export const AI_CONNECTION_ID_SUFFIX = '::ai'

export function aiConnectionIdOf(connectionId: string): string {
  return `${connectionId}${AI_CONNECTION_ID_SUFFIX}`
}

/** 드라이버 팩토리가 비밀 종류를 고르기 위해 파생 id를 되돌린다. */
export function parseConnectionId(id: string): { readonly baseId: string; readonly isAi: boolean } {
  if (!id.endsWith(AI_CONNECTION_ID_SUFFIX)) return { baseId: id, isAi: false }
  return { baseId: id.slice(0, -AI_CONNECTION_ID_SUFFIX.length), isAi: true }
}
