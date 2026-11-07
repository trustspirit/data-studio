import type { SecretStore } from '../core/ports/SecretStore'
import { emptyWorkspace, workspaceSchema, type SavedTabs, type SavedWorkspace } from '../../shared/types/workspace'

/** SQL may contain sensitive literals, so recovery uses the encrypted store, not localStorage. */
export class WorkspaceStore {
  private readonly pending = new Map<string, Promise<void>>()
  constructor(private readonly secrets: SecretStore) {}
  async flush(): Promise<void> { await Promise.all([...this.pending.values()]) }

  async load(id: string): Promise<SavedWorkspace> {
    await this.pending.get(id)
    return this.read(id)
  }

  private async read(id: string): Promise<SavedWorkspace> {
    const raw = await this.secrets.get({ kind: 'workspace', ownerId: id })
    if (raw === null) return emptyWorkspace()
    try { return workspaceSchema.parse(JSON.parse(raw)) }
    catch { throw new Error('작업 복구 데이터가 손상되었습니다. 기존 데이터는 보존했습니다.') }
  }

  private update(id: string, change: (workspace: SavedWorkspace) => SavedWorkspace): Promise<void> {
    const next = (this.pending.get(id) ?? Promise.resolve()).catch(() => {}).then(async () => {
      const value = JSON.stringify(change(await this.read(id)))
      if (Buffer.byteLength(value) > 2 * 1024 * 1024) throw new Error('작업 복구 저장 한도(2MB)에 도달했습니다.')
      await this.secrets.set({ kind: 'workspace', ownerId: id }, value)
    })
    this.pending.set(id, next)
    void next.finally(() => { if (this.pending.get(id) === next) this.pending.delete(id) }).catch(() => {})
    return next
  }

  saveTabs(id: string, tabs: SavedTabs): Promise<void> {
    return this.update(id, (workspace) => ({ ...workspace, tabs }))
  }
  saveDraft(id: string, serial: number, sql: string): Promise<void> {
    return this.update(id, (workspace) => ({ ...workspace, drafts: { ...workspace.drafts, [serial]: sql } }))
  }
}
