/**
 * renderer가 호출할 수 있는 IPC 채널 이름.
 * preload는 이 목록에 있는 채널만 노출한다.
 */
export const CHANNELS = {
  connectionList: 'connection:list',
  connectionSave: 'connection:save',
  connectionDelete: 'connection:delete',
  secretsStatus: 'secrets:status',
} as const

export type ChannelName = (typeof CHANNELS)[keyof typeof CHANNELS]

export const ALL_CHANNELS: readonly ChannelName[] = Object.values(CHANNELS)
