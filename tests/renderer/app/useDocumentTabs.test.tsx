// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useDocumentTabs, EMPTY_TAB_SET } from '@renderer/app/model/useDocumentTabs'
import { documentKey } from '@renderer/entities/document'

const ORDERS = { kind: 'table', schema: 'public', table: 'orders' } as const
const USERS = { kind: 'table', schema: 'public', table: 'users' } as const

describe('useDocumentTabs', () => {
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

  it('싱글턴 문서를 한 번만 자동으로 연다', () => {
    const { result } = renderHook(() => useDocumentTabs())
    act(() => result.current.ensureDefaults('c1', ['keyvalue']))
    act(() => result.current.ensureDefaults('c1', ['keyvalue']))
    expect(result.current.tabs['c1']?.documents).toEqual([{ kind: 'keys' }])
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
