import { createIpcConnectionGateway } from '../gateways/ipc/ipcConnectionGateway'
import type { DataconBridge } from '../gateways/ipc/ipcInvoke'
import type { ConnectionGateway } from '../gateways/ports/ConnectionGateway'

/** 렌더러가 의존하는 게이트웨이 묶음. 조립 지점에서만 생성한다. */
export interface Gateways {
  readonly connection: ConnectionGateway
}

/** preload 다리를 받아 게이트웨이를 조립한다. 순수 함수 — 테스트에서 가짜 bridge 주입. */
export function buildGateways(bridge: DataconBridge): Gateways {
  return { connection: createIpcConnectionGateway(bridge) }
}
