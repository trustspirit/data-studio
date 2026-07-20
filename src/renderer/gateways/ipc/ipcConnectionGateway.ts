import type { ConnectionConfig } from '../../../shared/types/connection'
import type { ConnectionGateway } from '../ports/ConnectionGateway'
import { invokeUnwrapped, type DataconBridge } from './ipcInvoke'

/**
 * `window.datacon.invoke`를 감싸는 커넥션 게이트웨이. bridge를 주입받아
 * 테스트에서 가짜 invoke를 넣을 수 있다.
 */
export function createIpcConnectionGateway(bridge: DataconBridge): ConnectionGateway {
  return {
    list: () => invokeUnwrapped<ConnectionConfig[]>(bridge, 'connection:list', undefined),
    save: async (config) => {
      await invokeUnwrapped<null>(bridge, 'connection:save', config)
    },
    delete: async (id) => {
      await invokeUnwrapped<null>(bridge, 'connection:delete', { id })
    },
    setSecret: async (connectionId, value) => {
      await invokeUnwrapped<null>(bridge, 'secrets:set', { connectionId, value })
    },
    hasSecret: async (connectionId) => {
      const result = await invokeUnwrapped<{ exists: boolean }>(bridge, 'secrets:has', {
        connectionId,
      })
      return result.exists
    },
    secretsPersistent: async () => {
      const result = await invokeUnwrapped<{ persistent: boolean }>(
        bridge,
        'secrets:status',
        undefined,
      )
      return result.persistent
    },
  }
}
