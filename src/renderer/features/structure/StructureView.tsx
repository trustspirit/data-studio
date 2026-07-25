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
  /** 컬럼/인덱스 행에서 연 경우의 대상 이름. 폼에서 다시 고르지 않게 한다. */
  const [target, setTarget] = useState('')
  const [structureToken, setStructureToken] = useState(0)
  const openDesigner = (mode: DesignerMode, forTarget = '') => {
    setTarget(forTarget)
    setDesigner(mode)
  }
  const closeDesigner = () => {
    setTarget('')
    setDesigner(null)
  }
  useEffect(() => {
    // 연결이 바뀌면 선택을 초기화한다 (useSchemaTree의 캐시 리셋과 일관).
    setSelected(null)
    setDesigner(null)
    setTarget('')
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
          // 다른 테이블을 고르면 이전 테이블 기준의 폼은 무의미하다. create만
          // 테이블 선택과 무관하므로 남긴다.
          setDesigner((d) => (d === 'create' ? d : null))
          setTarget('')
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
              onClick={() => openDesigner('create')}
            >
              New Table
            </Button>
            {selected !== null && (
              <>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  data-testid="ddl-open-rename-table"
                  onClick={() => openDesigner('renameTable')}
                >
                  Rename Table
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  data-testid="ddl-open-add-column"
                  onClick={() => openDesigner('addColumn')}
                >
                  Add Column
                </Button>
              </>
            )}
            {selected !== null && supportsAddForeignKey(dialect) && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                data-testid="ddl-open-fk"
                onClick={() => openDesigner('fk')}
              >
                Add Foreign Key
              </Button>
            )}
            {selected !== null && (
              <>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  data-testid="ddl-open-index"
                  onClick={() => openDesigner('index')}
                >
                  Add Index
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  data-testid="ddl-open-drop-table"
                  onClick={() => openDesigner('dropTable')}
                >
                  Drop Table
                </Button>
              </>
            )}
          </DdlToolbar>
        )}
        {dialect !== null && designer !== null ? (
          <TableDesigner
            key={`${designer}:${selected?.schema ?? ''}.${selected?.table ?? ''}:${target}`}
            dialect={dialect}
            mode={designer}
            schemas={tree.schemas.map((s) => s.name)}
            selection={selected}
            existing={{ columns: structure.columns, indexes: structure.indexes }}
            initialTarget={target}
            onRun={runDdl}
            onClose={closeDesigner}
          />
        ) : (
          <StructurePanel
            hasSelection={selected !== null}
            loading={structure.loading}
            error={structure.error}
            columns={structure.columns}
            indexes={structure.indexes}
            foreignKeys={structure.foreignKeys}
            {...(dialect !== null && selected !== null
              ? {
                  onRenameColumn: (column: string) => openDesigner('renameColumn', column),
                  onDropColumn: (column: string) => openDesigner('dropColumn', column),
                  onDropIndex: (indexName: string) => openDesigner('dropIndex', indexName),
                }
              : {})}
          />
        )}
      </Main>
    </Layout>
  )
}
