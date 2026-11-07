// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useDocumentTabs, EMPTY_TAB_SET } from '@renderer/app/model/useDocumentTabs'
import { documentKey } from '@renderer/entities/document'

const ORDERS = { kind: 'table', schema: 'public', table: 'orders' } as const
const USERS = { kind: 'table', schema: 'public', table: 'users' } as const

describe('useDocumentTabs', () => {
  it('연결을 다시 열면 저장된 탭을 복구하고 쿼리 번호를 재사용하지 않는다', async () => {
    const workspace = {
      load: vi.fn().mockResolvedValue({ persistent: true, workspace: { tabs: { documents: [{ kind: 'query', serial: 4 }, ORDERS], activeKey: 'query:4' }, drafts: { 8: 'archived SQL' } } }),
      saveTabs: vi.fn().mockResolvedValue(undefined), saveDraft: vi.fn().mockResolvedValue(undefined),
    }
    const { result } = renderHook(() => useDocumentTabs(workspace))
    act(() => result.current.ensureDefaults('c1', ['sql', 'data']))
    await waitFor(() => expect(result.current.tabs['c1']?.documents).toHaveLength(2))
    expect(result.current.tabs['c1']?.activeKey).toBe('query:4')
    expect(result.current.nextQuerySerial('c1')).toBe(9)
    expect(workspace.saveTabs).toHaveBeenCalled()
  })
  it('처음에는 어느 연결에도 탭이 없다', () => {
    const { result } = renderHook(() => useDocumentTabs())
    expect(result.current.tabs['c1'] ?? EMPTY_TAB_SET).toEqual(EMPTY_TAB_SET)
  })

  it('문서를 열면 목록에 붙고 활성이 된다', () => {
    const { result } = renderHook(() => useDocumentTabs())
    act(() => result.current.open('c1', ORDERS))
    expect(result.current.tabs['c1']?.documents).toEqual([ORDERS])
    expect(result.current.tabs['c1']?.activeKey).toBe(documentKey(ORDERS))
  })

  it('같은 문서를 다시 열면 탭이 늘지 않고 기존 탭이 활성이 된다', () => {
    const { result } = renderHook(() => useDocumentTabs())
    act(() => result.current.open('c1', ORDERS))
    act(() => result.current.open('c1', USERS))
    act(() => result.current.open('c1', ORDERS))
    expect(result.current.tabs['c1']?.documents).toEqual([ORDERS, USERS])
    expect(result.current.tabs['c1']?.activeKey).toBe(documentKey(ORDERS))
  })

  it('연결끼리 탭이 섞이지 않는다', () => {
    const { result } = renderHook(() => useDocumentTabs())
    act(() => result.current.open('c1', ORDERS))
    act(() => result.current.open('c2', USERS))
    expect(result.current.tabs['c1']?.documents).toEqual([ORDERS])
    expect(result.current.tabs['c2']?.documents).toEqual([USERS])
  })

  it('활성 탭을 닫으면 오른쪽 탭이 활성이 된다', () => {
    const { result } = renderHook(() => useDocumentTabs())
    act(() => result.current.open('c1', ORDERS))
    act(() => result.current.open('c1', USERS))
    act(() => result.current.activate('c1', documentKey(ORDERS)))
    act(() => result.current.close('c1', documentKey(ORDERS)))
    expect(result.current.tabs['c1']?.activeKey).toBe(documentKey(USERS))
  })

  it('오른쪽에 탭이 없으면 왼쪽 탭이 활성이 된다', () => {
    const { result } = renderHook(() => useDocumentTabs())
    act(() => result.current.open('c1', ORDERS))
    act(() => result.current.open('c1', USERS))
    act(() => result.current.close('c1', documentKey(USERS)))
    expect(result.current.tabs['c1']?.activeKey).toBe(documentKey(ORDERS))
  })

  it('마지막 탭을 닫으면 활성이 없어진다', () => {
    const { result } = renderHook(() => useDocumentTabs())
    act(() => result.current.open('c1', ORDERS))
    act(() => result.current.close('c1', documentKey(ORDERS)))
    expect(result.current.tabs['c1']?.documents).toEqual([])
    expect(result.current.tabs['c1']?.activeKey).toBeNull()
  })

  it('비활성 탭을 닫아도 활성은 그대로다', () => {
    const { result } = renderHook(() => useDocumentTabs())
    act(() => result.current.open('c1', ORDERS))
    act(() => result.current.open('c1', USERS))
    act(() => result.current.close('c1', documentKey(ORDERS)))
    expect(result.current.tabs['c1']?.activeKey).toBe(documentKey(USERS))
  })

  it('연결을 잊으면 그 연결의 탭 세트가 사라진다', () => {
    const { result } = renderHook(() => useDocumentTabs())
    act(() => result.current.open('c1', ORDERS))
    act(() => result.current.forget('c1'))
    expect(result.current.tabs['c1']).toBeUndefined()
  })

  it('없는 키를 닫아도 아무 일도 일어나지 않는다 (tabs 참조 보존)', () => {
    const { result } = renderHook(() => useDocumentTabs())
    act(() => result.current.open('c1', ORDERS))
    const before = result.current.tabs
    act(() => result.current.close('c1', 'nonexistent-key'))
    expect(result.current.tabs).toBe(before)
  })

  it('이미 활성인 탭을 다시 activate해도 아무 일도 일어나지 않는다 (tabs 참조 보존)', () => {
    const { result } = renderHook(() => useDocumentTabs())
    act(() => result.current.open('c1', ORDERS))
    const before = result.current.tabs
    act(() => result.current.activate('c1', documentKey(ORDERS)))
    expect(result.current.tabs).toBe(before)
  })

  it('싱글턴 문서를 한 번만 자동으로 연다 — 두 번째 호출이 사용자가 고른 활성 탭을 훔치지 않는다', () => {
    const { result } = renderHook(() => useDocumentTabs())
    act(() => result.current.ensureDefaults('c1', ['keyvalue']))
    // 사용자가 다른 문서를 열고 그걸 활성으로 삼는다.
    act(() => result.current.open('c1', ORDERS))
    act(() => result.current.activate('c1', documentKey(ORDERS)))
    // 같은 연결에 ensureDefaults가 다시 불려도(예: 재연결 이벤트 중복) 문서
    // 목록도, 사용자가 고른 활성 탭도 그대로여야 한다.
    act(() => result.current.ensureDefaults('c1', ['keyvalue']))
    expect(result.current.tabs['c1']?.documents).toEqual([{ kind: 'keys' }, ORDERS])
    expect(result.current.tabs['c1']?.activeKey).toBe(documentKey(ORDERS))
  })

  it('SQL 연결에는 자동으로 여는 문서가 없다', () => {
    const { result } = renderHook(() => useDocumentTabs())
    act(() => result.current.ensureDefaults('c1', ['sql', 'schema', 'data']))
    expect(result.current.tabs['c1']?.documents ?? []).toEqual([])
  })

  it('쿼리 serial은 연결 안에서 1부터 올라간다', () => {
    const { result } = renderHook(() => useDocumentTabs())
    let first = 0
    let second = 0
    act(() => { first = result.current.nextQuerySerial('c1') })
    act(() => { second = result.current.nextQuerySerial('c1') })
    expect(first).toBe(1)
    expect(second).toBe(2)
  })
})
