/**
 * main→renderer push 채널 화이트리스트. invoke 채널(`IPC_CONTRACT`)과 **분리**한다 —
 * 요청 채널을 push로 열지 않는다. preload의 `on`이 이 목록만 구독 허용한다.
 */
export const PUSH_CHANNELS = ['stream:message'] as const
export type PushChannelName = (typeof PUSH_CHANNELS)[number]

export function isPushChannel(name: string): name is PushChannelName {
  return (PUSH_CHANNELS as readonly string[]).includes(name)
}
