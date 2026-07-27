import { useState } from 'react'
import styled from 'styled-components'
import type { EngineId } from '@shared/types/connection'
import type { OperationGateway } from '../../../gateways/ports/OperationGateway'
import { Button, SplitPane } from '../../../shared/ui'
import { readPanelSize, writePanelSize } from '../../../shared/lib'
import { darkTheme } from '../../../shared/theme'
import { useQueryRunner } from '../model/useQueryRunner'
import { useSqlSchema } from '../model/useSqlSchema'
import { SqlEditor } from './SqlEditor'
import { ResultArea } from './ResultArea'

const Layout = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: ${({ theme }) => theme.color.surface.bg};
  color: ${({ theme }) => theme.color.fg.primary};
`
const EditorPane = styled.div`
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: ${({ theme }) => theme.space.sm};
`
const RunBar = styled.div`
  display: flex;
  justify-content: flex-end;
  padding: ${({ theme }) => `0 0 ${theme.space.xs}`};
`

// connectionName은 더 이상 여기서 쓰지 않는다 — 셸 상태바가 이미 연결
// 이름을 보여 준다. 이 컴포넌트의 유일한 호출부(DocumentHost)까지 한 줄만
// 고치면 되므로, 죽은 prop을 남겨 lint의 "미사용 구조 분해"를 자초하는 대신
// 인터페이스에서도 완전히 뺀다.
interface Props {
  gateway: OperationGateway
  connectionId: string
  /** SQL 방언·자동완성 선택용. 미지정이면 표준 SQL + 키워드 완성만 동작. */
  engine?: EngineId | undefined
}

/** 저장된 값이 다른 창 크기에서 온 것이라 지금 min/max 밖일 수 있다 — 항상 다시 가둔다. */
function clampEditorSize(size: number): number {
  return Math.min(darkTheme.size.editorMax, Math.max(darkTheme.size.editorMin, size))
}

export function QueryWorkspace({ gateway, connectionId, engine }: Props) {
  const q = useQueryRunner(gateway, connectionId)
  // 스키마/테이블 자동완성 — engine이 명시된 실사용 경로에서만 조회한다.
  const completion = useSqlSchema(gateway, connectionId, engine !== undefined)
  const [editorSize, setEditorSize] = useState(() =>
    clampEditorSize(readPanelSize('editor', darkTheme.size.editorDefault)),
  )
  return (
    <Layout>
      <SplitPane
        direction="column"
        anchor="first"
        size={editorSize}
        min={darkTheme.size.editorMin}
        max={darkTheme.size.editorMax}
        onSizeChange={(size) => {
          setEditorSize(size)
          writePanelSize('editor', size)
        }}
        label="에디터 높이"
        testId="split-editor"
        first={
          <EditorPane>
            <SqlEditor
              value={q.sql}
              onChange={q.setSql}
              onRun={() => void q.run()}
              engine={engine}
              namespace={completion.namespace}
              defaultSchema={completion.defaultSchema}
            />
          </EditorPane>
        }
        second={
          <>
            <RunBar>
              {q.running ? (
                <Button variant="secondary" size="sm" data-testid="query-cancel" onClick={q.cancel}>
                  Cancel
                </Button>
              ) : (
                <Button size="sm" data-testid="query-run" onClick={() => void q.run()}>
                  Run
                </Button>
              )}
            </RunBar>
            <ResultArea
              columns={q.columns}
              rows={q.rows}
              rowsAffected={q.rowsAffected}
              notices={q.notices}
              error={q.error}
              hasMore={q.hasMore}
              onLoadMore={() => void q.loadMore()}
            />
          </>
        }
      />
    </Layout>
  )
}
