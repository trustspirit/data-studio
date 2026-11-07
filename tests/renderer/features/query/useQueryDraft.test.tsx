// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useQueryDraft } from '@renderer/features/query/model/useQueryDraft'

describe('SQL draft recovery', () => {
  it('저장이 끝나기 전에는 창 종료로 초안을 잃지 않도록 막는다', async () => {
    let finish!: () => void
    const pending = new Promise<void>((resolve) => { finish = resolve })
    const workspace = { load: vi.fn().mockResolvedValue({ persistent: true, workspace: { tabs: { documents: [], activeKey: null }, drafts: {} } }), saveTabs: vi.fn(), saveDraft: vi.fn().mockReturnValue(pending) }
    const setSql = vi.fn()
    const { result } = renderHook(() => useQueryDraft(workspace, 'c1', 1, setSql))
    await waitFor(() => expect(result.current.ready).toBe(true))
    act(() => result.current.change('SELECT 1'))
    const closing = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(closing)
    expect(closing.defaultPrevented).toBe(true)
    await act(async () => { finish(); await pending })
    const saved = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(saved)
    expect(saved.defaultPrevented).toBe(false)
  })
  it('restores the correct document and saves edits through the encrypted gateway', async () => {
    const setSql = vi.fn()
    const workspace = { load: vi.fn().mockResolvedValue({ persistent: true, workspace: { tabs: { documents: [], activeKey: null }, drafts: { 3: 'SELECT 3' } } }), saveTabs: vi.fn(), saveDraft: vi.fn().mockResolvedValue(undefined) }
    const { result } = renderHook(() => useQueryDraft(workspace, 'c1', 3, setSql))
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(setSql).toHaveBeenCalledWith('SELECT 3')
    act(() => result.current.change('SELECT 4'))
    expect(workspace.saveDraft).toHaveBeenCalledWith('c1', 3, 'SELECT 4')
  })
  it('does not overwrite a draft after a failed recovery', async () => {
    const workspace = { load: vi.fn().mockRejectedValue(new Error('disk')), saveTabs: vi.fn(), saveDraft: vi.fn() }
    const setSql = vi.fn()
    const { result } = renderHook(() => useQueryDraft(workspace, 'c1', 3, setSql))
    await waitFor(() => expect(result.current.error).not.toBeNull())
    act(() => result.current.change('new text'))
    expect(workspace.saveDraft).not.toHaveBeenCalled()
    expect(result.current.ready).toBe(true)
  })
})
