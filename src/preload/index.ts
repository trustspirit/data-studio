import { contextBridge, ipcRenderer } from 'electron'
import { ALL_CHANNELS, type ChannelName } from '../shared/contracts/channels'

const allowed = new Set<string>(ALL_CHANNELS)

/**
 * 임의 채널 호출을 허용하지 않는다. 화이트리스트에 없는 이름은
 * main에 도달하기 전에 여기서 막힌다.
 */
function invoke(channel: ChannelName, input: unknown): Promise<unknown> {
  if (!allowed.has(channel)) {
    return Promise.reject(new Error(`channel not allowed: ${channel}`))
  }
  return ipcRenderer.invoke(channel, input)
}

contextBridge.exposeInMainWorld('datacon', { invoke })
