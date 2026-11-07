import { describe, expect, it } from 'vitest'
import { WorkspaceStore } from '@main/infrastructure/WorkspaceStore'
import { EphemeralSecretStore } from '@main/infrastructure/EphemeralSecretStore'

describe('encrypted workspace recovery', () => {
  it('concurrent tab and SQL saves survive a new store instance', async () => {
    const secrets = new EphemeralSecretStore()
    const store = new WorkspaceStore(secrets)
    await Promise.all([
      store.saveDraft('one', 1, 'SELECT secret FROM users'),
      store.saveTabs('one', { documents: [{ kind: 'query', serial: 1 }], activeKey: 'query:1' }),
      store.saveDraft('one', 2, 'SELECT 2'),
    ])
    const saved = await new WorkspaceStore(secrets).load('one')
    expect(saved.tabs.activeKey).toBe('query:1')
    expect(saved.drafts).toEqual({ 1: 'SELECT secret FROM users', 2: 'SELECT 2' })
    expect((await store.load('two')).drafts).toEqual({})
  })

  it('corruption is surfaced and never overwritten', async () => {
    const secrets = new EphemeralSecretStore()
    await secrets.set({ kind: 'workspace', ownerId: 'one' }, 'corrupt original')
    const store = new WorkspaceStore(secrets)
    await expect(store.saveDraft('one', 1, 'SELECT 1')).rejects.toThrow('손상')
    expect(await secrets.get({ kind: 'workspace', ownerId: 'one' })).toBe('corrupt original')
  })
})
