import { useCallback, useRef, useState } from 'react'
import type { Capability } from '../../../shared/types/capability'
import { autoDocuments, documentKey, type Document } from '../../entities/document'

export interface TabSet {
  readonly documents: readonly Document[]
  readonly activeKey: string | null
}

export const EMPTY_TAB_SET: TabSet = { documents: [], activeKey: null }

export interface DocumentTabsState {
  readonly tabs: Readonly<Record<string, TabSet>>
  open: (connectionId: string, doc: Document) => void
  close: (connectionId: string, key: string) => void
  activate: (connectionId: string, key: string) => void
  /** 연결이 닫히거나 목록에서 사라졌다 — 탭 세트를 버린다. */
  forget: (connectionId: string) => void
  /** 접속 직후 싱글턴 문서를 연다. 두 번 불러도 한 번만 연다. */
  ensureDefaults: (connectionId: string, capabilities: readonly Capability[]) => void
  /** 새 쿼리 문서에 붙일 번호. 연결 안에서 1부터 증가한다. */
  nextQuerySerial: (connectionId: string) => number
}

function openIn(set: TabSet, doc: Document): TabSet {
  const key = documentKey(doc)
  // 이미 열려 있으면 새 탭을 만들지 않는다 — 같은 객체가 두 탭에 있으면
  // 어느 쪽 편집이 진짜인지 알 수 없다.
  if (set.documents.some((d) => documentKey(d) === key)) return { ...set, activeKey: key }
  return { documents: [...set.documents, doc], activeKey: key }
}

function closeIn(set: TabSet, key: string): TabSet {
  const index = set.documents.findIndex((d) => documentKey(d) === key)
  if (index < 0) return set
  const documents = set.documents.filter((_, i) => i !== index)
  if (set.activeKey !== key) return { documents, activeKey: set.activeKey }
  // 닫은 자리의 오른쪽, 없으면 왼쪽 — 편집기 관례다.
  const nextDoc = documents[index] ?? documents[index - 1] ?? null
  return { documents, activeKey: nextDoc === null ? null : documentKey(nextDoc) }
}

/**
 * 연결 id로 키잉한 문서 탭 상태. 사이드바 트리(셸)와 워크스페이스가 같은 동작을
 * 공유하므로 소유자는 공통 조상인 셸이다.
 */
export function useDocumentTabs(): DocumentTabsState {
  const [tabs, setTabs] = useState<Readonly<Record<string, TabSet>>>({})
  /** 자동 열기를 이미 수행한 연결. 상태 반영은 비동기라 ref로만 정확하다. */
  const seeded = useRef<Set<string>>(new Set())
  /** 연결별 쿼리 번호. 탭을 닫아도 번호를 재사용하지 않는다. */
  const serials = useRef<Map<string, number>>(new Map())

  const open = useCallback((connectionId: string, doc: Document) => {
    setTabs((cur) => ({ ...cur, [connectionId]: openIn(cur[connectionId] ?? EMPTY_TAB_SET, doc) }))
  }, [])

  const close = useCallback((connectionId: string, key: string) => {
    setTabs((cur) => {
      const set = cur[connectionId]
      if (set === undefined) return cur
      return { ...cur, [connectionId]: closeIn(set, key) }
    })
  }, [])

  const activate = useCallback((connectionId: string, key: string) => {
    setTabs((cur) => {
      const set = cur[connectionId]
      if (set === undefined || !set.documents.some((d) => documentKey(d) === key)) return cur
      return { ...cur, [connectionId]: { ...set, activeKey: key } }
    })
  }, [])

  const forget = useCallback((connectionId: string) => {
    seeded.current.delete(connectionId)
    serials.current.delete(connectionId)
    setTabs((cur) => {
      if (!(connectionId in cur)) return cur
      const rest = { ...cur }
      delete rest[connectionId]
      return rest
    })
  }, [])

  const ensureDefaults = useCallback((connectionId: string, capabilities: readonly Capability[]) => {
    if (seeded.current.has(connectionId)) return
    seeded.current.add(connectionId)
    const defaults = autoDocuments(capabilities)
    if (defaults.length === 0) {
      setTabs((cur) => (connectionId in cur ? cur : { ...cur, [connectionId]: EMPTY_TAB_SET }))
      return
    }
    setTabs((cur) => ({
      ...cur,
      [connectionId]: defaults.reduce(openIn, cur[connectionId] ?? EMPTY_TAB_SET),
    }))
  }, [])

  const nextQuerySerial = useCallback((connectionId: string) => {
    const next = (serials.current.get(connectionId) ?? 0) + 1
    serials.current.set(connectionId, next)
    return next
  }, [])

  return { tabs, open, close, activate, forget, ensureDefaults, nextQuerySerial }
}
