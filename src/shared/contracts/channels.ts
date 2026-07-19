import { contractChannels, type ContractChannel } from './ipcContract'

/**
 * renderer가 호출할 수 있는 IPC 채널 이름.
 *
 * 채널 목록의 유일한 출처는 `IPC_CONTRACT`다. 여기서 유도하므로, 계약에 채널을
 * 추가하면 preload 화이트리스트가 자동으로 따라온다 — 두 목록이 어긋날 수 없다.
 */
export type ChannelName = ContractChannel

export const ALL_CHANNELS: readonly ChannelName[] = contractChannels()
