import { useCallback, useRef, useState } from 'react'
import type { AiAccountStatus, ConnectionGateway } from '../../gateways/ports/ConnectionGateway'
import type { TableSelection } from '../../entities/schema-tree'
import type { Capability } from '../../../shared/types/capability'

export type OpenState = 'connecting' | 'ready' | 'error'

export interface OpenConnection {
  readonly state: OpenState
  readonly capabilities: readonly Capability[]
  readonly aiAccount: AiAccountStatus
  readonly error: string | null
}

export interface OpenConnectionsState {
  /** 열려 있거나 여는 중이거나 열기에 실패한 연결. 닫으면 사라진다. */
  readonly open: Readonly<Record<string, OpenConnection>>
  /** 메인 영역이 보여 주는 연결. `ready`인 것만 가리킨다. */
  readonly activeId: string | null
  readonly expanded: Readonly<Record<string, boolean>>
  readonly selection: Readonly<Record<string, TableSelection | null>>
  openConnection: (id: string) => Promise<void>
  closeConnection: (id: string) => Promise<void>
  setActive: (id: string) => void
  toggleExpanded: (id: string) => void
  setSelection: (id: string, sel: TableSelection | null) => void
  /** 목록에서 사라진 연결(삭제 등)의 셸 상태를 버린다. */
  forget: (id: string) => void
}

/**
 * 열린 연결과 활성 연결은 한 상태로 묶는다. 따로 두면 "닫힌 연결을 활성으로
 * 가리키는" 중간 상태가 생기고, 다음 활성을 고르려면 setState 업데이터 안에서
 * 다른 setState를 불러야 한다(StrictMode가 업데이터를 두 번 호출한다).
 */
interface OpenSet {
  readonly open: Readonly<Record<string, OpenConnection>>
  readonly activeId: string | null
}

const EMPTY: OpenSet = { open: {}, activeId: null }

function withEntry(prev: OpenSet, id: string, entry: OpenConnection, activate: boolean): OpenSet {
  return {
    open: { ...prev.open, [id]: entry },
    activeId: activate ? id : prev.activeId,
  }
}

function without(prev: OpenSet, id: string): OpenSet {
  if (!(id in prev.open)) return prev
  const open = { ...prev.open }
  delete open[id]
  if (prev.activeId !== id) return { open, activeId: prev.activeId }
  const fallback = Object.keys(open).find((k) => open[k]?.state === 'ready') ?? null
  return { open, activeId: fallback }
}

/**
 * "무엇이 열려 있고 무엇이 활성인가" — 셸의 네비게이션 상태.
 *
 * 도메인 데이터가 아니라 셸 상태이므로 `app/`에 산다. 사이드바 트리(entities),
 * 메인 워크스페이스(app), 설정 패널(features/connections)이 모두 이걸 읽는데
 * 셋을 합법적으로 아는 층은 app뿐이다.
 */
export function useOpenConnections(gateway: ConnectionGateway): OpenConnectionsState {
  const [set, setSet] = useState<OpenSet>(EMPTY)
  const [expanded, setExpanded] = useState<Readonly<Record<string, boolean>>>({})
  const [selection, setSelectionState] = useState<Readonly<Record<string, TableSelection | null>>>({})
  // 열기 요청이 겹치면 같은 연결에 connection:open이 두 번 나간다. 상태 반영은
  // 비동기라 in-flight 판정은 ref로만 정확하다.
  const opening = useRef<Set<string>>(new Set())

  const openConnection = useCallback(
    async (id: string) => {
      if (opening.current.has(id)) return
      opening.current.add(id)
      setSet((prev) =>
        withEntry(prev, id, { state: 'connecting', capabilities: [], aiAccount: 'none', error: null }, false),
      )
      try {
        const result = await gateway.open(id)
        if (!result.opened) {
          setSet((prev) =>
            withEntry(prev, id, { state: 'error', capabilities: [], aiAccount: 'none', error: result.reason }, false),
          )
          return
        }
        setSet((prev) =>
          withEntry(
            prev,
            id,
            {
              state: 'ready',
              capabilities: result.capabilities,
              aiAccount: result.aiAccount,
              error: null,
            },
            true,
          ),
        )
        setExpanded((cur) => ({ ...cur, [id]: true }))
      } catch (e) {
        const error = e instanceof Error ? e.message : 'unknown error'
        setSet((prev) => withEntry(prev, id, { state: 'error', capabilities: [], aiAccount: 'none', error }, false))
      } finally {
        opening.current.delete(id)
      }
    },
    [gateway],
  )

  const closeConnection = useCallback(
    async (id: string) => {
      // 풀을 실제로 닫는다. 이 호출이 없으면 연결이 앱이 죽을 때까지 살아 있다.
      await gateway.close(id)
      opening.current.delete(id)
      setSet((prev) => without(prev, id))
    },
    [gateway],
  )

  const forget = useCallback((id: string) => {
    opening.current.delete(id)
    setSet((prev) => without(prev, id))
    setExpanded((cur) => {
      if (!(id in cur)) return cur
      const rest = { ...cur }
      delete rest[id]
      return rest
    })
    setSelectionState((cur) => {
      if (!(id in cur)) return cur
      const rest = { ...cur }
      delete rest[id]
      return rest
    })
  }, [])

  const setActive = useCallback((id: string) => {
    setSet((prev) => (prev.open[id]?.state === 'ready' ? { ...prev, activeId: id } : prev))
  }, [])
  const toggleExpanded = useCallback((id: string) => {
    setExpanded((cur) => ({ ...cur, [id]: cur[id] !== true }))
  }, [])
  const setSelection = useCallback((id: string, sel: TableSelection | null) => {
    setSelectionState((cur) => ({ ...cur, [id]: sel }))
  }, [])

  return {
    open: set.open,
    activeId: set.activeId,
    expanded,
    selection,
    openConnection,
    closeConnection,
    setActive,
    toggleExpanded,
    setSelection,
    forget,
  }
}
