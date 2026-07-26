import { useEffect, useRef, useState } from 'react'
import styled from 'styled-components'
import type { EngineId, SqlEngineId } from '../../shared/types/connection'
import { SQL_ENGINE_IDS } from '../../shared/types/connection'
import type { ColumnInfo, IndexInfo } from '../../shared/types/schema'
import type { OperationGateway } from '../gateways/ports/OperationGateway'
import type { AiGateway } from '../gateways/ports/AiGateway'
import { documentKey, type Document } from '../entities/document'
import { Button, EmptyState, SplitPane, Toolbar } from '../shared/ui'
import { readPanelSize, writePanelSize } from '../shared/lib'
import { InspectorDock, type InspectorSection } from '../features/inspector'
import {
  DESIGNER_TABLE_ACTIONS,
  DesignerOverlay,
  TableInspector,
  supportsAddForeignKey,
  type DesignerMode,
} from '../features/structure'
import { QueryWorkspace } from '../features/query'
import { DataView } from '../features/data'
import { ErView } from '../features/er'
import { DocumentsView } from '../features/documents'
import { KeyBrowserView } from '../features/keys'
import { StreamsView } from '../features/streams'
import { DynamoView } from '../features/dynamo'
import { AiChatPanel } from '../features/ai'
import { darkTheme } from '../shared/theme'

const Host = styled.div`
  position: relative;
  flex: 1;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
`
const Pane = styled.div`
  flex: 1;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  &[hidden] {
    display: none;
  }
`
const Body = styled.div`
  flex: 1;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
`
const Title = styled.span`
  font-family: ${({ theme }) => theme.font.ui};
  font-size: ${({ theme }) => theme.fontSize.sm};
  color: ${({ theme }) => theme.color.textDim};
  margin-right: auto;
`

function sqlDialectOf(engine: EngineId | undefined): SqlEngineId | null {
  if (engine === undefined) return null
  return (SQL_ENGINE_IDS as readonly EngineId[]).includes(engine) ? (engine as SqlEngineId) : null
}

interface StructureSnapshot {
  readonly columns: readonly ColumnInfo[]
  readonly indexes: readonly IndexInfo[]
}

/** 아직 아무 응답도 못 받은 문서를 위한 기본값. 매 렌더 새 객체를 만들지 않도록 모듈 스코프에 둔다. */
const EMPTY_STRUCTURE: StructureSnapshot = { columns: [], indexes: [] }

interface DocumentHostProps {
  documents: readonly Document[]
  activeKey: string | null
  gateway: OperationGateway
  ai?: AiGateway | undefined
  connectionId: string
  engine?: EngineId | undefined
  schemas: readonly string[]
  onSchemaChanged?: (() => void) | undefined
  /** ER에서 테이블을 누르면 그 테이블 문서를 연다. */
  onOpenDocument: (doc: Document) => void
}

/**
 * 열린 문서를 전부 마운트해 두고 활성만 보여 준다. 언마운트하면 작성 중인 SQL과
 * 그리드 편집이 사라진다 — 탭을 오가는 흐름에서 그건 데이터 손실이다. 대가는
 * 숨은 문서의 effect(스트림 구독 등)가 계속 산다는 것이고, 언마운트 시점은
 * 오직 탭 닫기와 연결 닫기다.
 */
export function DocumentHost({
  documents,
  activeKey,
  gateway,
  ai,
  connectionId,
  engine,
  schemas,
  onSchemaChanged,
  onOpenDocument,
}: DocumentHostProps) {
  const [inspectorSize, setInspectorSize] = useState(() =>
    readPanelSize('inspector', darkTheme.size.inspectorDefault),
  )
  /** 열려 있는 DDL 폼. 문서 하나에만 붙으므로 호스트가 들고 있는다. */
  const [designer, setDesigner] = useState<{ mode: DesignerMode; target: string } | null>(null)
  /** DDL이 통과할 때마다 올라간다 — 인스펙터가 이걸 보고 구조를 다시 읽는다. */
  const [structureToken, setStructureToken] = useState(0)
  /**
   * 문서 키별 구조 스냅샷. 열린 테이블 문서마다 자기 TableInspector가 자기
   * 몫만 적는다 — 슬롯을 하나만 두면 나중에 응답이 오는 쪽(대개 비활성 문서,
   * 네트워크 타이밍은 활성 여부를 모른다)이 활성 문서의 컬럼을 덮어써 버려서
   * DDL 오버레이의 rename/drop 폼이 엉뚱한 테이블 컬럼을 보여줄 수 있었다.
   */
  const [structureByDoc, setStructureByDoc] = useState<Readonly<Record<string, StructureSnapshot>>>({})
  /**
   * 문서 키마다 신원이 고정된 콜백을 재사용한다 — TableInspector의
   * onStructureLoaded effect는 이 콜백을 deps에 넣는다. 매 렌더 새 화살표를
   * 주면 setState가 새 렌더를 부르고 그때마다 새 콜백이 생겨 effect가 다시
   * 도는 무한 루프에 빠진다. ref에 문서 키별로 하나씩만 만들어 재사용한다.
   */
  const structureWriters = useRef(new Map<string, (s: StructureSnapshot) => void>())
  const noteStructureFor = (key: string): ((s: StructureSnapshot) => void) => {
    const cached = structureWriters.current.get(key)
    if (cached !== undefined) return cached
    const writer = (s: StructureSnapshot) => setStructureByDoc((prev) => ({ ...prev, [key]: s }))
    structureWriters.current.set(key, writer)
    return writer
  }

  const resizeInspector = (size: number) => {
    setInspectorSize(size)
    writePanelSize('inspector', size)
  }

  /**
   * 활성 문서가 바뀌면 열려 있던 DDL 폼을 닫는다. `key`로 다시 마운트해도
   * `designer.target`은 호스트 상태라 그대로 살아남는다 — 재마운트만으로는
   * "Drop Column" 폼이 다른 테이블 위에서 컬럼 미선택 상태로 뜨는 걸 막지
   * 못한다(선택은 비어도 미리보기 SQL은 옛 대상 그대로다). 사용자가 다른
   * 테이블로 넘어갔다는 뜻으로 읽고 아예 닫는 것이 정직한 해석이다. `key`는
   * 그래도 남겨 둔다 — 이 effect보다 먼저 도는 방어선이다.
   */
  useEffect(() => {
    setDesigner(null)
  }, [activeKey])

  const dialect = sqlDialectOf(engine)
  const aiSections: readonly InspectorSection[] =
    ai === undefined
      ? []
      : [
          {
            id: 'ai',
            title: 'AI',
            grow: true,
            content: <AiChatPanel ai={ai} operation={gateway} connectionId={connectionId} />,
          },
        ]

  if (documents.length === 0) {
    return (
      <Host>
        <div data-testid="document-empty" style={{ flex: 1, display: 'flex' }}>
          <EmptyState
            title="열린 문서가 없습니다."
            hint="사이드바에서 테이블을 두 번 누르거나 ＋로 쿼리를 여세요"
          />
        </div>
      </Host>
    )
  }

  const activeTarget = activeTableOf(documents, activeKey)
  // DDL 폼은 늘 활성 문서를 대상으로 한다(활성 문서의 툴바에서만 열 수 있다) —
  // 그래서 existing도 activeKey 몫만 읽는다. 아직 응답이 없으면 빈 구조로 보여 준다.
  const existingForDesigner = (activeKey !== null ? structureByDoc[activeKey] : undefined) ?? EMPTY_STRUCTURE

  /**
   * 문서 종류별 본문. `switch`로 두는 이유는 if/else 사슬이면 여덟 번째 종류가
   * 추가돼도 마지막 `else`로 조용히 흘러 컴파일이 통과하기 때문이다 — 이
   * 파일에서 그 실수를 막는 유일한 곳이 되면 안 된다. `document.ts`가 이미
   * `documentKey`/`documentTitle`에서 강제하는 `_exhaustive: never` 관례를
   * 그대로 따른다.
   */
  function bodyFor(doc: Document) {
    switch (doc.kind) {
      case 'table':
        return (
          <DataView gateway={gateway} connectionId={connectionId} selection={{ schema: doc.schema, table: doc.table }} />
        )
      case 'query':
        return <QueryWorkspace gateway={gateway} connectionId={connectionId} engine={engine} />
      case 'er':
        return (
          <ErView
            gateway={gateway}
            connectionId={connectionId}
            schema={doc.schema}
            onOpenTable={(schema, table) => onOpenDocument({ kind: 'table', schema, table })}
          />
        )
      case 'collection':
        return <DocumentsView gateway={gateway} connectionId={connectionId} />
      case 'keys':
        return <KeyBrowserView gateway={gateway} connectionId={connectionId} />
      case 'stream':
        return <StreamsView gateway={gateway} connectionId={connectionId} />
      case 'items':
        return <DynamoView gateway={gateway} connectionId={connectionId} />
      default: {
        const _exhaustive: never = doc
        return _exhaustive
      }
    }
  }

  /** 테이블 문서만 구조 인스펙터를 갖는다. 나머지는 AI 섹션만(있으면) 붙는다. */
  function inspectorFor(doc: Document, key: string) {
    switch (doc.kind) {
      case 'table':
        return (
          <TableInspector
            gateway={gateway}
            connectionId={connectionId}
            selection={{ schema: doc.schema, table: doc.table }}
            reloadToken={structureToken}
            extraSections={aiSections}
            onStructureLoaded={noteStructureFor(key)}
            {...(dialect !== null
              ? {
                  onRenameColumn: (column: string) => setDesigner({ mode: 'renameColumn', target: column }),
                  onDropColumn: (column: string) => setDesigner({ mode: 'dropColumn', target: column }),
                  onDropIndex: (indexName: string) => setDesigner({ mode: 'dropIndex', target: indexName }),
                }
              : {})}
          />
        )
      case 'query':
      case 'er':
      case 'collection':
      case 'keys':
      case 'stream':
      case 'items':
        return aiSections.length > 0 ? <InspectorDock sections={aiSections} /> : null
      default: {
        const _exhaustive: never = doc
        return _exhaustive
      }
    }
  }

  /** 테이블·ER 문서만 DDL 액션을 툴바에 갖는다. dialect가 없으면(비-SQL 엔진) 아무것도 없다. */
  function toolbarFor(doc: Document) {
    switch (doc.kind) {
      case 'table':
        return dialect !== null ? (
          <Toolbar>
            <Title>
              {doc.schema}.{doc.table}
            </Title>
            {/* 엔진이 ALTER TABLE로 FK를 못 붙이면 그 버튼은 오류 배너로만 끝난다 —
                열리지 않는 탭을 권하지 않는 것과 같은 규칙이다. */}
            {DESIGNER_TABLE_ACTIONS.filter(
              (a) => a.mode !== 'fk' || supportsAddForeignKey(dialect),
            ).map((a) => (
              <Button
                key={a.mode}
                type="button"
                variant="secondary"
                size="sm"
                data-testid={a.testId}
                onClick={() => setDesigner({ mode: a.mode, target: '' })}
              >
                {a.label}
              </Button>
            ))}
          </Toolbar>
        ) : null
      case 'er':
        return dialect !== null ? (
          <Toolbar>
            <Title>{doc.schema}</Title>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              data-testid="ddl-open-create"
              onClick={() => setDesigner({ mode: 'create', target: '' })}
            >
              New Table
            </Button>
          </Toolbar>
        ) : null
      case 'query':
      case 'collection':
      case 'keys':
      case 'stream':
      case 'items':
        return null
      default: {
        const _exhaustive: never = doc
        return _exhaustive
      }
    }
  }

  return (
    <Host>
      {documents.map((doc) => {
        const key = documentKey(doc)
        const inactive = key !== activeKey
        const body = bodyFor(doc)
        const inspector = inspectorFor(doc, key)
        const toolbar = toolbarFor(doc)

        return (
          <Pane key={key} data-testid={`docpane-${key}`} hidden={inactive} aria-hidden={inactive}>
            {toolbar}
            {inspector === null ? (
              <Body>{body}</Body>
            ) : (
              <SplitPane
                direction="row"
                anchor="second"
                size={inspectorSize}
                min={darkTheme.size.inspectorMin}
                max={darkTheme.size.inspectorMax}
                onSizeChange={resizeInspector}
                label="인스펙터 크기"
                testId="split-inspector"
                first={<Body>{body}</Body>}
                second={inspector}
              />
            )}
          </Pane>
        )
      })}
      {designer !== null && dialect !== null && (
        <DesignerOverlay
          // 실제 방어는 위 useEffect(activeKey가 바뀌면 designer를 닫는다)다.
          // 이 key는 2차 방어선이다 — 닫는 effect보다 먼저 렌더가 도는
          // 경우에도 폼이 옛 대상의 입력값을 들고 새 대상 위에 뜨는 일은
          // 없게 한다.
          key={`${designer.mode}:${activeTarget?.schema ?? ''}.${activeTarget?.table ?? ''}:${designer.target}`}
          gateway={gateway}
          connectionId={connectionId}
          dialect={dialect}
          mode={designer.mode}
          target={designer.target}
          selection={activeTarget}
          schemas={schemas}
          existing={existingForDesigner}
          onClose={() => setDesigner(null)}
          onRan={() => {
            setStructureToken((t) => t + 1)
            onSchemaChanged?.()
          }}
        />
      )}
    </Host>
  )
}

/** DDL 폼이 대상으로 삼는 테이블. 활성 문서가 테이블일 때만 있다. */
function activeTableOf(
  documents: readonly Document[],
  activeKey: string | null,
): { readonly schema: string; readonly table: string } | null {
  const active = documents.find((d) => documentKey(d) === activeKey)
  return active !== undefined && active.kind === 'table' ? { schema: active.schema, table: active.table } : null
}
