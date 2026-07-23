/**
 * 드라이버가 노출하는 능력의 **문자열 식별자**. 실제 능력은 Driver의 선택적
 * capability 객체(존재=증거)이며, 이 유니온은 IPC로 renderer에 내려보내 UI 탭을
 * 게이팅하는 파생 목록이다. renderer가 main을 import할 수 없어 여기(@shared)에 둔다.
 * 새 capability(document/keyvalue/stream)가 생기면 여기에 문자열을 추가한다.
 */
export const CAPABILITIES = ['sql', 'schema', 'data', 'document'] as const
export type Capability = (typeof CAPABILITIES)[number]
