import { useCallback, useEffect, useState } from 'react'
import styled from 'styled-components'
import type { OperationGateway } from '../../gateways/ports/OperationGateway'
import { SchemaNavigator, useSchemaTree, type TableSelection } from '../../entities/schema-tree'
import { SQL_ENGINE_IDS, type EngineId, type SqlEngineId } from '../../../shared/types/connection'
import { failureText } from '../../shared/lib'
import { Button, ErrorBanner } from '../../shared/ui'
import { useTableStructure } from './model/useTableStructure'
import { supportsAddForeignKey } from './model/ddlBuilder'
import { StructurePanel } from './ui/StructurePanel'
import { TableDesigner, type DesignerMode } from './ui/TableDesigner'

const Layout = styled.div`
  display: flex;
  height: 100%;
  min-height: 0;
  background: ${({ theme }) => theme.color.winBg};
  color: ${({ theme }) => theme.color.text};
`
const Main = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  overflow: hidden;
`
const DdlToolbar = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.space.xs};
  padding: ${({ theme }) => `${theme.space.xs} ${theme.space.sm}`};
  border-bottom: 1px solid ${({ theme }) => theme.color.borderSoft};
  background: ${({ theme }) => theme.color.toolbar};
`

function sqlDialectOf(engine: EngineId | undefined): SqlEngineId | null {
  if (engine === undefined) return null
  return (SQL_ENGINE_IDS as readonly EngineId[]).includes(engine) ? (engine as SqlEngineId) : null
}

interface StructureViewProps {
  gateway: OperationGateway
  connectionId: string
  externalSelection?: TableSelection | null
  /** 테이블 디자이너의 DDL 방언 선택용. SQL 엔진이 아니면 디자이너가 숨는다. */
  engine?: EngineId | undefined
}

export function StructureView({
  gateway,
  connectionId,
  externalSelection,
  engine,
}: StructureViewProps) {
  const tree = useSchemaTree(gateway, connectionId)
  const [selected, setSelected] = useState<TableSelection | null>(null)
  const [designer, setDesigner] = useState<DesignerMode | null>(null)
  const [structureToken, setStructureToken] = useState(0)
  useEffect(() => {
    // 연결이 바뀌면 선택을 초기화한다 (useSchemaTree의 캐시 리셋과 일관).
    setSelected(null)
    setDesigner(null)
  }, [connectionId])
  useEffect(() => {
    // ER 뷰 등 상위가 특정 테이블을 열도록 요청하면 내부 선택을 시드한다.
    // prop 미전달(undefined)·null이면 아무 것도 하지 않아 기존 동작이 그대로 유지된다.
    if (externalSelection) setSelected(externalSelection)
  }, [externalSelection])
  const structure = useTableStructure(gateway, connectionId, selected, structureToken)

  const dialect = sqlDialectOf(engine)
  const treeReload = tree.reload

  const runDdl = useCallback(
    async (sql: string): Promise<string | null> => {
      try {
        const outcome = await gateway.run({
          requestId: crypto.randomUUID(),
          connectionId,
          operation: { kind: 'sql', sql },
        })
        if (!outcome.ok) return failureText(outcome)
        // DDL이 통과했으니 트리와 현재 테이블 구조를 서버 기준으로 다시 읽는다.
        treeReload()
        setStructureToken((t) => t + 1)
        return null
      } catch (e) {
        return e instanceof Error ? e.message : 'unknown error'
      }
    },
    [gateway, connectionId, treeReload],
  )

  return (
    <Layout>
      <SchemaNavigator
        schemas={tree.schemas}
        tablesBySchema={tree.tablesBySchema}
        expanded={tree.expanded}
        selected={selected}
        onToggle={tree.toggle}
        onSelect={(sel) => {
          setSelected(sel)
          // 다른 테이블을 고르면 이전 테이블 기준의 FK/인덱스 폼은 무의미하다.
          setDesigner((d) => (d === 'create' ? d : null))
        }}
      />
      <Main>
        {tree.error !== null && <ErrorBanner>{tree.error}</ErrorBanner>}
        {dialect !== null && (
          <DdlToolbar>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              data-testid="ddl-open-create"
              onClick={() => setDesigner('create')}
            >
              New Table
            </Button>
            {selected !== null && supportsAddForeignKey(dialect) && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                data-testid="ddl-open-fk"
                onClick={() => setDesigner('fk')}
              >
                Add Foreign Key
              </Button>
            )}
            {selected !== null && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                data-testid="ddl-open-index"
                onClick={() => setDesigner('index')}
              >
                Add Index
              </Button>
            )}
          </DdlToolbar>
        )}
        {dialect !== null && designer !== null ? (
          <TableDesigner
            key={`${designer}:${selected?.schema ?? ''}.${selected?.table ?? ''}`}
            dialect={dialect}
            mode={designer}
            schemas={tree.schemas.map((s) => s.name)}
            selection={selected}
            onRun={runDdl}
            onClose={() => setDesigner(null)}
          />
        ) : (
          <StructurePanel
            hasSelection={selected !== null}
            loading={structure.loading}
            error={structure.error}
            columns={structure.columns}
            indexes={structure.indexes}
            foreignKeys={structure.foreignKeys}
          />
        )}
      </Main>
    </Layout>
  )
}
