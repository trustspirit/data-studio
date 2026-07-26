import { useEffect, useRef } from 'react'
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
  /** 테이블을 문서로 연다(더블클릭·Enter). 고르기와는 다른 동작이다. */
  onOpen: (selection: TableSelection) => void
  /** 스키마 단위 문서(ER)를 연다. 없으면 트리에 버튼이 나오지 않는다. */
  onOpenSchema?: ((schema: string) => void) | undefined
  /** 스키마 이름을 셸로 올린다 — 테이블 디자이너가 자동완성에 쓴다. */
  onSchemasLoaded?: ((names: readonly string[]) => void) | undefined
  /** 값이 바뀌면 서버 기준으로 다시 읽는다(DDL 실행 후). */
  reloadToken?: number | undefined
}

/**
 * 트리에서 연결 하나 아래에 붙는 스키마/테이블 가지.
 *
 * `useSchemaTree`는 연결 하나에 묶인 훅이고 훅은 루프로 호출할 수 없다. 그래서
 * 연결마다 이 컴포넌트를 하나씩 렌더한다 — A의 확장 상태와 테이블 캐시는 B와
 * 물리적으로 다른 클로저에 있어서 맵을 손으로 관리할 필요가 없다.
 */
export function ConnectionBranch({
  gateway,
  connectionId,
  selected,
  onSelect,
  onOpen,
  onOpenSchema,
  onSchemasLoaded,
  reloadToken = 0,
}: ConnectionBranchProps) {
  const tree = useSchemaTree(gateway, connectionId)
  const schemas = tree.schemas
  useEffect(() => {
    onSchemasLoaded?.(schemas.map((s) => s.name))
  }, [schemas, onSchemasLoaded])

  const treeReload = tree.reload
  const seenToken = useRef(reloadToken)
  useEffect(() => {
    // 마운트 시점의 조회는 훅이 이미 한다 — 토큰이 실제로 움직였을 때만 다시 읽는다.
    if (seenToken.current === reloadToken) return
    seenToken.current = reloadToken
    treeReload()
  }, [reloadToken, treeReload])

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
        onOpen={onOpen}
        {...(onOpenSchema !== undefined ? { onOpenSchema } : {})}
      />
    </>
  )
}
