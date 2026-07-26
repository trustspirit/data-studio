import { useRef } from 'react'
import styled from 'styled-components'
import type { ConnectionConfig } from '../../shared/types/connection'
import type { OperationGateway } from '../gateways/ports/OperationGateway'
import type { AiGateway } from '../gateways/ports/AiGateway'
import type { Document } from '../entities/document'
import { ConnectionWorkspace } from './ConnectionWorkspace'
import { EMPTY_TAB_SET, type TabSet } from './model/useDocumentTabs'
import type { OpenConnection } from './model/useOpenConnections'

const Host = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
`
const Pane = styled.div`
  flex: 1;
  min-height: 0;
  min-width: 0;
  &[hidden] {
    display: none;
  }
`

interface WorkspaceHostProps {
  connections: readonly ConnectionConfig[]
  open: Readonly<Record<string, OpenConnection>>
  activeId: string | null
  gateway: OperationGateway
  ai?: AiGateway | undefined
  /** 연결별 탭 세트. 셸이 소유한다. */
  tabs: Readonly<Record<string, TabSet>>
  onOpenDocument: (connectionId: string, doc: Document) => void
  onCloseDocument: (connectionId: string, key: string) => void
  onActivateDocument: (connectionId: string, key: string) => void
  onNewQuery: (connectionId: string) => void
  /** 연결별 스키마 이름(테이블 디자이너 자동완성용). */
  schemas?: Readonly<Record<string, readonly string[]>> | undefined
  onSchemaChanged?: ((connectionId: string) => void) | undefined
  /** 연결 하나에 스테이징된 편집을 가진 문서가 하나라도 있는지 알린다 — 연결 닫기/삭제 확인에 쓴다. */
  onConnectionDirtyChange: (connectionId: string, dirty: boolean) => void
}

/**
 * 열린 연결마다 워크스페이스를 하나씩 마운트하고 활성인 것만 보여 준다.
 *
 * `key={activeId}`로 하나만 마운트하면 전환할 때마다 작성 중인 SQL·열린 문서·
 * 그리드 편집·AI 세션이 통째로 사라진다. 반대로 key 없이 인스턴스를 재사용하면
 * 그 상태들이 연결 사이로 새어 나간다. 그래서 숨기는 쪽을 택했다 — 대가는
 * 비활성 연결의 effect(스트림 구독 등)가 계속 산다는 것이고, 언마운트 시점은
 * 오직 연결 닫기다.
 *
 * `hidden`과 `aria-hidden`을 함께 준다. `hidden`만으로는 접근성 트리에서
 * 사라지지 않아 보조 기술과 role 기반 조회가 숨은 워크스페이스까지 본다.
 */
export function WorkspaceHost({
  connections,
  open,
  activeId,
  gateway,
  ai,
  tabs,
  onOpenDocument,
  onCloseDocument,
  onActivateDocument,
  onNewQuery,
  schemas,
  onSchemaChanged,
  onConnectionDirtyChange,
}: WorkspaceHostProps) {
  const panes = connections.filter((c) => open[c.id]?.state === 'ready')

  /**
   * 연결 키마다 신원이 고정된 dirty 리포터를 재사용한다 — `DocumentHost`의
   * `dirtyReporters`와 같은 이유다. `ConnectionWorkspace`의 dirty-sync effect가
   * 이 콜백을 deps에 넣으므로, 매 렌더 새 화살표를 주면(다른 연결이 리렌더될
   * 때마다) effect가 다시 돈다. 연결 키당 하나씩만 만들어 재사용해, 연결 A의
   * 편집 상태가 연결 B의 리포터 정체성에 영향을 주지 못하게 한다.
   */
  const dirtyReporters = useRef(new Map<string, (dirty: boolean) => void>())
  const reporterFor = (connectionId: string): ((dirty: boolean) => void) => {
    const cached = dirtyReporters.current.get(connectionId)
    if (cached !== undefined) return cached
    const fn = (dirty: boolean) => onConnectionDirtyChange(connectionId, dirty)
    dirtyReporters.current.set(connectionId, fn)
    return fn
  }

  return (
    <Host>
      {panes.map((c) => {
        const entry = open[c.id]
        const inactive = c.id !== activeId
        return (
          <Pane
            key={c.id}
            data-testid={`workspace-${c.id}`}
            hidden={inactive}
            aria-hidden={inactive}
          >
            <ConnectionWorkspace
              key={c.id}
              gateway={gateway}
              ai={ai}
              connectionId={c.id}
              connectionName={c.name}
              capabilities={entry?.capabilities ?? []}
              engine={c.engine}
              aiAccount={entry?.aiAccount ?? 'none'}
              tabs={tabs[c.id] ?? EMPTY_TAB_SET}
              onOpenDocument={(doc) => onOpenDocument(c.id, doc)}
              onCloseDocument={(key) => onCloseDocument(c.id, key)}
              onActivateDocument={(key) => onActivateDocument(c.id, key)}
              onNewQuery={() => onNewQuery(c.id)}
              onConnectionDirtyChange={reporterFor(c.id)}
              {...(schemas !== undefined ? { schemas: schemas[c.id] ?? [] } : {})}
              {...(onSchemaChanged !== undefined
                ? { onSchemaChanged: () => onSchemaChanged(c.id) }
                : {})}
            />
          </Pane>
        )
      })}
    </Host>
  )
}
