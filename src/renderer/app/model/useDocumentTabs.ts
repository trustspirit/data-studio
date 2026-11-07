import { useCallback, useEffect, useRef, useState } from 'react'
import type { Capability } from '../../../shared/types/capability'
import { autoDocuments, canOpen, documentKey, type Document } from '../../entities/document'
import type { WorkspaceGateway } from '../../gateways/ports/WorkspaceGateway'

export interface TabSet {
  readonly documents: readonly Document[]
  readonly activeKey: string | null
}

export const EMPTY_TAB_SET: TabSet = { documents: [], activeKey: null }

export interface DocumentTabsState {
  readonly tabs: Readonly<Record<string, TabSet>>
  readonly recoveryError: string | null
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
export function useDocumentTabs(workspace?: WorkspaceGateway): DocumentTabsState {
  const [tabs, setTabs] = useState<Readonly<Record<string, TabSet>>>({})
  const [recoveryError, setRecoveryError] = useState<string | null>(null)
  const restored = useRef(new Set<string>())
  const persisted = useRef(new Map<string, TabSet>())
  const generations = useRef(new Map<string, number>())
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
      const next = closeIn(set, key)
      // 대상 키가 없으면 closeIn이 같은 참조를 돌려준다 — 그걸 그대로
      // 전체 상태에 되씌우면 참조가 바뀌어 불필요한 리렌더가 퍼진다.
      if (next === set) return cur
      return { ...cur, [connectionId]: next }
    })
  }, [])

  const activate = useCallback((connectionId: string, key: string) => {
    setTabs((cur) => {
      const set = cur[connectionId]
      if (set === undefined || set.activeKey === key || !set.documents.some((d) => documentKey(d) === key)) {
        return cur
      }
      return { ...cur, [connectionId]: { ...set, activeKey: key } }
    })
  }, [])

  const forget = useCallback((connectionId: string) => {
    generations.current.set(connectionId, (generations.current.get(connectionId) ?? 0) + 1)
    seeded.current.delete(connectionId)
    serials.current.delete(connectionId)
    restored.current.delete(connectionId)
    persisted.current.delete(connectionId)
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
    const token = generations.current.get(connectionId) ?? 0
    if (workspace !== undefined) {
      void workspace.load(connectionId).then(({ workspace: saved }) => {
        if (!seeded.current.has(connectionId) || (generations.current.get(connectionId) ?? 0) !== token) return
        const documents = [...new Map(saved.tabs.documents.filter((doc) => canOpen(doc.kind, capabilities)).map((doc) => [documentKey(doc), doc])).values()]
        const maxSerial = Math.max(0, ...Object.keys(saved.drafts).map(Number), ...documents.filter((doc) => doc.kind === 'query').map((doc) => doc.serial))
        serials.current.set(connectionId, Math.max(serials.current.get(connectionId) ?? 0, maxSerial))
        restored.current.add(connectionId)
        setTabs((cur) => {
          const existing = cur[connectionId] ?? EMPTY_TAB_SET
          const activeKey = documents.some((doc) => documentKey(doc) === saved.tabs.activeKey) ? saved.tabs.activeKey : documents[0] === undefined ? null : documentKey(documents[0])
          const base = { documents, activeKey } as TabSet
          const next = [...existing.documents, ...autoDocuments(capabilities)].reduce(openIn, base)
          return { ...cur, [connectionId]: next }
        })
      }).catch(() => setRecoveryError('이전 작업을 복구하지 못했습니다. 저장된 데이터는 보존됩니다.'))
    }
    const defaults = autoDocuments(capabilities)
    if (defaults.length === 0) {
      setTabs((cur) => (connectionId in cur ? cur : { ...cur, [connectionId]: EMPTY_TAB_SET }))
      return
    }
    setTabs((cur) => ({
      ...cur,
      [connectionId]: defaults.reduce(openIn, cur[connectionId] ?? EMPTY_TAB_SET),
    }))
  }, [workspace])

  useEffect(() => {
    if (workspace === undefined) return
    for (const [id, set] of Object.entries(tabs)) {
      if (!restored.current.has(id) || persisted.current.get(id) === set) continue
      persisted.current.set(id, set)
      void workspace.saveTabs(id, { documents: [...set.documents], activeKey: set.activeKey })
        .catch(() => setRecoveryError('열린 탭을 저장하지 못했습니다. 앱을 닫기 전에 SQL을 별도로 보관하세요.'))
    }
  }, [tabs, workspace])

  const nextQuerySerial = useCallback((connectionId: string) => {
    const next = (serials.current.get(connectionId) ?? 0) + 1
    serials.current.set(connectionId, next)
    return next
  }, [])

  return { tabs, recoveryError, open, close, activate, forget, ensureDefaults, nextQuerySerial }
}
