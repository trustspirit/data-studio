import type { IpcResult, IpcFailureCode } from '../../../shared/contracts/ipcResult'
import type { ChannelName } from '../../../shared/contracts/channels'

/** preload가 노출하는 다리. */
export interface DataconBridge {
  invoke(channel: ChannelName, input: unknown): Promise<unknown>
}

/**
 * IPC 실패를 도메인 오류로 표현한다. feature는 IPC 형태(`ok`/`code`)를 몰라야
 * 하므로, 게이트웨이가 여기서 그것을 걷어내고 이 오류를 던진다.
 */
export class IpcError extends Error {
  constructor(
    readonly code: IpcFailureCode,
    readonly channel: string,
  ) {
    super(`ipc ${channel} failed: ${code}`)
    this.name = 'IpcError'
  }
}

/**
 * 채널을 부르고 `IpcResult`를 푼다. `{ ok: true }`면 값을, `{ ok: false }`면
 * `IpcError`를 던진다.
 */
export async function invokeUnwrapped<O>(
  bridge: DataconBridge,
  channel: ChannelName,
  input: unknown,
): Promise<O> {
  const result = (await bridge.invoke(channel, input)) as IpcResult<O>
  if (!result.ok) throw new IpcError(result.code, channel)
  return result.value
}
