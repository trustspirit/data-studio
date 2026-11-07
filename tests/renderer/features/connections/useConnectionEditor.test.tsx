// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ConnectionConfig } from '@shared/types/connection'
import type { ConnectionGateway } from '@renderer/gateways/ports/ConnectionGateway'
import { useConnections } from '@renderer/features/connections/model/useConnections'
import { useConnectionEditor } from '@renderer/features/connections/model/useConnectionEditor'

function conn(id: string, patch: Partial<ConnectionConfig> = {}): ConnectionConfig {
  return {
    id,
    name: id,
    engine: 'postgres',
    host: 'h',
    port: 5432,
    database: 'd',
    username: 'u',
    tlsMode: 'disable',
    aiReadOnlyUsername: null,
    maskedColumnPatterns: [],
    ...patch,
  }
}

interface FakeGateway extends ConnectionGateway {
  readonly calls: string[]
}

function fakeGateway(initial: ConnectionConfig[] = []): FakeGateway {
  const store = [...initial]
  const calls: string[] = []
  return {
    calls,
    list: vi.fn(() => Promise.resolve([...store])),
    save: vi.fn((c: ConnectionConfig) => {
      calls.push('save')
      const i = store.findIndex((x) => x.id === c.id)
      if (i >= 0) store[i] = c
      else store.push(c)
      return Promise.resolve()
    }),
    delete: vi.fn((id: string) => {
      calls.push('delete')
      const i = store.findIndex((x) => x.id === id)
      if (i >= 0) store.splice(i, 1)
      return Promise.resolve()
    }),
    setSecret: vi.fn((_id: string, _value: string, forAi?: boolean) => {
      calls.push(forAi === true ? 'setSecret:ai' : 'setSecret')
      return Promise.resolve()
    }),
    hasSecret: vi.fn(() => Promise.resolve(false)),
    secretsPersistent: vi.fn(() => Promise.resolve(true)),
    open: vi.fn(() => Promise.resolve({ opened: true }) as ReturnType<ConnectionGateway['open']>),
    close: vi.fn(() => Promise.resolve()),
    status: vi.fn(() => Promise.resolve('ready') as ReturnType<ConnectionGateway['status']>),
    openFileDialog: vi.fn(() => Promise.resolve('/tmp/picked.db')),
  }
}

function renderEditor(gw: ConnectionGateway) {
  return renderHook(() => {
    const state = useConnections(gw)
    return { state, editor: useConnectionEditor(gw, state) }
  })
}

describe('useConnectionEditor', () => {
  it('설정 저장 실패 후 비밀번호를 저장하거나 편집 상태를 성공으로 바꾸지 않는다', async () => {
    const gw = fakeGateway()
    gw.save = vi.fn().mockRejectedValue(new Error('disk full'))
    const { result } = renderEditor(gw)
    act(() => {
      result.current.editor.startNew()
      result.current.editor.change({ name: 'prod', host: 'db.local', database: 'shop', username: 'admin' })
      result.current.editor.setPassword('must-stay-local')
    })
    await act(async () => { await result.current.editor.save() })
    expect(result.current.editor.mode).toBe('new')
    expect(result.current.editor.password).toBe('must-stay-local')
    expect(result.current.state.error).toBe('disk full')
    expect(gw.calls).not.toContain('setSecret')
  })

  it('비밀번호 저장 실패를 표시하고 입력 값을 보존한다', async () => {
    const gw = fakeGateway()
    gw.setSecret = vi.fn().mockRejectedValue(new Error('keychain locked'))
    const { result } = renderEditor(gw)
    act(() => {
      result.current.editor.startNew()
      result.current.editor.change({ name: 'prod', host: 'db.local', database: 'shop', username: 'admin' })
      result.current.editor.setPassword('retry-me')
    })
    await act(async () => { await result.current.editor.save() })
    expect(result.current.editor.errors['form']).toBe('keychain locked')
    expect(result.current.editor.password).toBe('retry-me')
    expect(result.current.editor.saving).toBe(false)
  })

  it('검증에 실패하면 저장하지 않고 필드 오류를 남긴다', async () => {
    const gw = fakeGateway()
    const { result } = renderEditor(gw)
    act(() => result.current.editor.startNew())
    await act(async () => {
      await result.current.editor.save()
    })
    expect(result.current.editor.errors['name']).toBeDefined()
    expect(gw.calls).not.toContain('save')
  })

  it('비밀번호가 있으면 connection:save 뒤에 secrets:set을 부른다', async () => {
    const gw = fakeGateway()
    const { result } = renderEditor(gw)
    act(() => result.current.editor.startNew())
    act(() => {
      result.current.editor.change({ name: 'prod', host: 'db.local', database: 'shop', username: 'admin' })
      result.current.editor.setPassword('pw')
    })
    await act(async () => {
      await result.current.editor.save()
    })
    expect(gw.calls).toEqual(['save', 'setSecret'])
  })

  it('비밀번호가 비어 있으면 secrets:set을 부르지 않는다', async () => {
    const gw = fakeGateway()
    const { result } = renderEditor(gw)
    act(() => result.current.editor.startNew())
    act(() => {
      result.current.editor.change({ name: 'prod', host: 'db.local', database: 'shop', username: 'admin' })
    })
    await act(async () => {
      await result.current.editor.save()
    })
    // 빈 비밀번호로 setSecret을 부르면 빈 값을 저장해 기존 비밀을 덮는다.
    expect(gw.calls).toEqual(['save'])
  })

  it('AI 계정명을 비우면 입력해 둔 AI 비밀번호를 보내지 않는다', async () => {
    const gw = fakeGateway()
    const { result } = renderEditor(gw)
    act(() => result.current.editor.startNew())
    act(() => {
      result.current.editor.change({
        name: 'prod',
        host: 'db.local',
        database: 'shop',
        username: 'admin',
        aiReadOnlyUsername: 'ai_ro',
      })
      result.current.editor.setAiPassword('aipw')
    })
    // 계정명을 비운다 — 폼에서는 AI 비밀번호 필드가 사라지지만 입력값은 상태에 남는다.
    act(() => result.current.editor.change({ aiReadOnlyUsername: null }))
    await act(async () => {
      await result.current.editor.save()
    })
    // main이 connection:save에서 지운 AI 비밀을 다시 만들면 고아 비밀이 된다.
    expect(gw.calls).toEqual(['save'])
    expect(result.current.editor.hasSavedAiSecret).toBe(false)
  })

  it('AI 계정명이 남아 있으면 AI 비밀도 저장 뒤에 보낸다', async () => {
    const gw = fakeGateway()
    const { result } = renderEditor(gw)
    act(() => result.current.editor.startNew())
    act(() => {
      result.current.editor.change({
        name: 'prod',
        host: 'db.local',
        database: 'shop',
        username: 'admin',
        aiReadOnlyUsername: 'ai_ro',
      })
      result.current.editor.setPassword('pw')
      result.current.editor.setAiPassword('aipw')
    })
    await act(async () => {
      await result.current.editor.save()
    })
    expect(gw.calls).toEqual(['save', 'setSecret', 'setSecret:ai'])
  })

  it('선택된 연결이 초안으로 실리고 mode가 edit이 된다', async () => {
    const gw = fakeGateway([conn('a', { name: 'prod' })])
    const { result } = renderEditor(gw)
    await waitFor(() => expect(result.current.state.connections).toHaveLength(1))
    act(() => result.current.state.select('a'))
    await waitFor(() => expect(result.current.editor.mode).toBe('edit'))
    expect(result.current.editor.draft.name).toBe('prod')
  })

  it('삭제하면 목록에서 빠지고 새 초안으로 돌아간다', async () => {
    const gw = fakeGateway([conn('a')])
    const { result } = renderEditor(gw)
    await waitFor(() => expect(result.current.state.connections).toHaveLength(1))
    act(() => result.current.state.select('a'))
    await waitFor(() => expect(result.current.editor.mode).toBe('edit'))
    await act(async () => {
      await result.current.editor.remove()
    })
    expect(gw.calls).toContain('delete')
    expect(result.current.state.connections).toHaveLength(0)
    expect(result.current.editor.mode).toBe('new')
  })

  it('파일 선택 결과가 database 필드를 채운다', async () => {
    const gw = fakeGateway()
    const { result } = renderEditor(gw)
    act(() => result.current.editor.startNew())
    act(() => result.current.editor.browseFile())
    await waitFor(() => expect(result.current.editor.draft.database).toBe('/tmp/picked.db'))
  })
})
