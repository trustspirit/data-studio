import type { SavedTabs, SavedWorkspace } from '../../../shared/types/workspace'

export interface WorkspaceGateway {
  load(connectionId: string): Promise<{ workspace: SavedWorkspace; persistent: boolean }>
  saveTabs(connectionId: string, tabs: SavedTabs): Promise<void>
  saveDraft(connectionId: string, serial: number, sql: string): Promise<void>
}
