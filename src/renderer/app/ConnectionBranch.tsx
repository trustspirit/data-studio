import styled from 'styled-components'
import type { OperationGateway } from '../gateways/ports/OperationGateway'
import { SchemaNavigator, useSchemaTree, type TableSelection } from '../entities/schema-tree'

const BranchError = styled.div`
  padding: 2px ${({ theme }) => theme.space.sm} 6px 26px;
  color: ${({ theme }) => theme.color.red};
  font-size: ${({ theme }) => theme.fontSize.xs};
  word-break: break-word;
`

interface ConnectionBranchProps {
  gateway: OperationGateway
  connectionId: string
  selected: TableSelection | null
  onSelect: (selection: TableSelection) => void
}

/**
 * 트리에서 연결 하나 아래에 붙는 스키마/테이블 가지.
 *
 * `useSchemaTree`는 연결 하나에 묶인 훅이고 훅은 루프로 호출할 수 없다. 그래서
 * 연결마다 이 컴포넌트를 하나씩 렌더한다 — A의 확장 상태와 테이블 캐시는 B와
 * 물리적으로 다른 클로저에 있어서 맵을 손으로 관리할 필요가 없다.
 */
export function ConnectionBranch({ gateway, connectionId, selected, onSelect }: ConnectionBranchProps) {
  const tree = useSchemaTree(gateway, connectionId)
  return (
    <>
      {tree.error !== null && <BranchError data-testid={`branch-error-${connectionId}`}>{tree.error}</BranchError>}
      <SchemaNavigator
        inline
        depth={1}
        schemas={tree.schemas}
        tablesBySchema={tree.tablesBySchema}
        expanded={tree.expanded}
        selected={selected}
        onToggle={tree.toggle}
        onSelect={onSelect}
      />
    </>
  )
}
