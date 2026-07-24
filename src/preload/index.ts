import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { ALL_CHANNELS, type ChannelName } from '../shared/contracts/channels'
import { isPushChannel, type PushChannelName } from '../shared/contracts/pushChannels'

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

/**
 * main→renderer push 구독. `PUSH_CHANNELS`에 있는 채널만 허용한다 — invoke
 * 화이트리스트와 분리된 목록이다. 반환값은 리스너 해제 함수다.
 */
function on(channel: PushChannelName, listener: (payload: unknown) => void): () => void {
  if (!isPushChannel(channel)) {
    throw new Error(`push channel not allowed: ${channel}`)
  }
  const handler = (_event: IpcRendererEvent, payload: unknown): void => listener(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

contextBridge.exposeInMainWorld('datacon', { invoke, on })
