import type { WorkspaceGateway } from '../ports/WorkspaceGateway'
import { invokeUnwrapped, type DataconBridge } from './ipcInvoke'
import { emptyWorkspace, workspaceSchema } from '../../../shared/types/workspace'

export function createIpcWorkspaceGateway(bridge: DataconBridge): WorkspaceGateway {
  return {
    async load(connectionId) {
      const result = await invokeUnwrapped<{ workspace: unknown; persistent: boolean } | null>(bridge, 'workspace:load', { connectionId })
      if (result === null) return { workspace: emptyWorkspace(), persistent: false }
      return { workspace: workspaceSchema.parse(result.workspace), persistent: result.persistent }
    },
    async saveTabs(connectionId, tabs) { await invokeUnwrapped(bridge, 'workspace:saveTabs', { connectionId, tabs }) },
    async saveDraft(connectionId, serial, sql) { await invokeUnwrapped(bridge, 'workspace:saveDraft', { connectionId, serial, sql }) },
  }
}
