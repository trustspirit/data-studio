import styled from 'styled-components'
import type { ConnectionConfig } from '../../shared/types/connection'
import type { OperationGateway } from '../gateways/ports/OperationGateway'
import type { AiGateway } from '../gateways/ports/AiGateway'
import type { TableSelection } from '../entities/schema-tree'
import { ConnectionWorkspace } from './ConnectionWorkspace'
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
  /** 연결별 선택 테이블. 사이드바 트리와 같은 출처를 읽는다. */
  selection?: Readonly<Record<string, TableSelection | null>> | undefined
  onSelectionChange?: ((connectionId: string, selection: TableSelection | null) => void) | undefined
  /** 연결별 스키마 이름(테이블 디자이너 자동완성용). */
  schemas?: Readonly<Record<string, readonly string[]>> | undefined
  onSchemaChanged?: ((connectionId: string) => void) | undefined
}

/**
 * 열린 연결마다 워크스페이스를 하나씩 마운트하고 활성인 것만 보여 준다.
 *
 * `key={activeId}`로 하나만 마운트하면 전환할 때마다 작성 중인 SQL·서브탭 선택·
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
  selection,
  onSelectionChange,
  schemas,
  onSchemaChanged,
}: WorkspaceHostProps) {
  const panes = connections.filter((c) => open[c.id]?.state === 'ready')
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
              {...(selection !== undefined ? { selection: selection[c.id] ?? null } : {})}
              {...(onSelectionChange !== undefined
                ? { onSelectionChange: (sel: TableSelection | null) => onSelectionChange(c.id, sel) }
                : {})}
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
