import { useCallback, type KeyboardEvent } from 'react'
import styled from 'styled-components'
import type { ColumnInfo, IndexInfo } from '../../../../shared/types/schema'
import type { SqlEngineId } from '../../../../shared/types/connection'
import type { OperationGateway } from '../../../gateways/ports/OperationGateway'
import type { TableSelection } from '../../../entities/schema-tree'
import { failureText } from '../../../shared/lib'
import { TableDesigner, type DesignerMode } from './TableDesigner'

const Backdrop = styled.div`
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  z-index: 1;
`
const Sheet = styled.div`
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: min(560px, 100%);
  display: flex;
  flex-direction: column;
  background: ${({ theme }) => theme.color.surface.panel};
  border-left: 1px solid ${({ theme }) => theme.color.borders.strong};
  z-index: 2;
  overflow: hidden;
`

/** 테이블 문서 툴바가 그리는 DDL 액션. 대상 테이블이 있어야 의미가 있다. */
export const DESIGNER_TABLE_ACTIONS: readonly { mode: DesignerMode; label: string; testId: string }[] = [
  { mode: 'renameTable', label: 'Rename Table', testId: 'ddl-open-rename-table' },
  { mode: 'addColumn', label: 'Add Column', testId: 'ddl-open-add-column' },
  { mode: 'fk', label: 'Add Foreign Key', testId: 'ddl-open-fk' },
  { mode: 'index', label: 'Add Index', testId: 'ddl-open-index' },
  { mode: 'dropTable', label: 'Drop Table', testId: 'ddl-open-drop-table' },
]

interface DesignerOverlayProps {
  gateway: OperationGateway
  connectionId: string
  dialect: SqlEngineId
  mode: DesignerMode
  /** 컬럼·인덱스 행에서 연 경우의 대상 이름. 폼에서 다시 고르지 않게 한다. */
  target: string
  selection: TableSelection | null
  schemas: readonly string[]
  existing: { readonly columns: readonly ColumnInfo[]; readonly indexes: readonly IndexInfo[] }
  onClose: () => void
  /** DDL이 통과했다 — 호출자가 트리와 구조를 다시 읽는다. */
  onRan: () => void
}

/**
 * DDL 폼을 문서 위에 띄운다. 탭으로 만들지 않는 이유는 renameColumn/dropIndex처럼
 * 특정 컬럼·인덱스에 묶인 모드가 있어서다 — 그것들은 탭이 될 만한 대상이 아니다.
 */
export function DesignerOverlay({
  gateway,
  connectionId,
  dialect,
  mode,
  target,
  selection,
  schemas,
  existing,
  onClose,
  onRan,
}: DesignerOverlayProps) {
  const runDdl = useCallback(
    async (sql: string): Promise<string | null> => {
      try {
        const outcome = await gateway.run({
          requestId: crypto.randomUUID(),
          connectionId,
          operation: { kind: 'sql', sql },
        })
        if (!outcome.ok) return failureText(outcome)
        // 닫는 것은 TableDesigner의 몫이다 — onRun이 null을 돌려주면 그쪽에서 onClose를
        // 부른다. 여기서 또 부르면 성공할 때마다 onClose가 두 번 불린다.
        onRan()
        return null
      } catch (e) {
        return e instanceof Error ? e.message : 'unknown error'
      }
    },
    [gateway, connectionId, onRan],
  )

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') onClose()
  }

  return (
    <div data-testid="designer-overlay" onKeyDown={onKeyDown} role="presentation">
      <Backdrop data-testid="designer-backdrop" onClick={onClose} />
      <Sheet>
        <TableDesigner
          dialect={dialect}
          mode={mode}
          schemas={schemas}
          selection={selection}
          existing={existing}
          initialTarget={target}
          onRun={runDdl}
          onClose={onClose}
        />
      </Sheet>
    </div>
  )
}
