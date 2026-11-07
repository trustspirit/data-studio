import { lazy, Suspense, useState } from 'react'
import styled from 'styled-components'
import type { EngineId } from '@shared/types/connection'
import type { OperationGateway } from '../../../gateways/ports/OperationGateway'
import { Button, ErrorBanner, Notice, SplitPane } from '../../../shared/ui'
import type { WorkspaceGateway } from '../../../gateways/ports/WorkspaceGateway'
import { useQueryDraft } from '../model/useQueryDraft'
import { readPanelSize, writePanelSize } from '../../../shared/lib'
import { darkTheme } from '../../../shared/theme'
import { useQueryRunner } from '../model/useQueryRunner'
import { useSqlSchema } from '../model/useSqlSchema'
const SqlEditor = lazy(() => import('./SqlEditor').then((module) => ({ default: module.SqlEditor })))
import { ResultArea } from './ResultArea'
import { downloadResultCsv } from '../../../entities/result-set/renderers/resultCsv'

const Layout = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: ${({ theme }) => theme.color.surface.bg};
  color: ${({ theme }) => theme.color.text.primary};
`
const EditorPane = styled.div`
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: ${({ theme }) => theme.space.sm};
`
const RunBar = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.space.sm};
  padding: ${({ theme }) => `${theme.space.sm} ${theme.space.md}`};
  background: ${({ theme }) => theme.color.surface.base};
  border-top: 1px solid ${({ theme }) => theme.color.border.soft};
`
const Status = styled.span`
  flex: 1;
  color: ${({ theme }) => theme.color.text.dim};
  font-size: ${({ theme }) => theme.fontSize.label};
  font-variant-numeric: tabular-nums;
`

// connectionName은 더 이상 여기서 쓰지 않는다 — 셸 상태바가 이미 연결
// 이름을 보여 준다. 이 컴포넌트의 유일한 호출부(DocumentHost)까지 한 줄만
// 고치면 되므로, 죽은 prop을 남겨 lint의 "미사용 구조 분해"를 자초하는 대신
// 인터페이스에서도 완전히 뺀다.
interface Props {
  workspace?: WorkspaceGateway | undefined
  serial?: number | undefined
  gateway: OperationGateway
  connectionId: string
  /** SQL 방언·자동완성 선택용. 미지정이면 표준 SQL + 키워드 완성만 동작. */
  engine?: EngineId | undefined
}

/** 저장된 값이 다른 창 크기에서 온 것이라 지금 min/max 밖일 수 있다 — 항상 다시 가둔다. */
function clampEditorSize(size: number): number {
  return Math.min(darkTheme.size.editorMax, Math.max(darkTheme.size.editorMin, size))
}

export function QueryWorkspace({ gateway, connectionId, engine, workspace, serial }: Props) {
  const q = useQueryRunner(gateway, connectionId)
  const draft = useQueryDraft(workspace, connectionId, serial, q.setSql)
  // 스키마/테이블 자동완성 — engine이 명시된 실사용 경로에서만 조회한다.
  const completion = useSqlSchema(gateway, connectionId, engine !== undefined)
  const [editorSize, setEditorSize] = useState(() =>
    clampEditorSize(readPanelSize('editor', darkTheme.size.editorDefault)),
  )
  return (
    <Layout>
      {draft.error !== null && <ErrorBanner>{draft.error}</ErrorBanner>}
      {!draft.persistent && <Notice>암호화 저장소를 사용할 수 없어 SQL 초안은 이번 실행 중에만 유지됩니다.</Notice>}
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
            <Suspense fallback={<Notice>SQL 편집기를 불러오는 중…</Notice>}><SqlEditor
              value={q.sql}
              onChange={draft.change}
              onRun={() => { if (draft.ready && q.sql.trim() !== '') void q.run() }}
              engine={engine}
              namespace={completion.namespace}
              defaultSchema={completion.defaultSchema}
            /></Suspense>
          </EditorPane>
        }
        second={
          <>
            <RunBar>
              <Status role="status" aria-live="polite">
                {q.running ? '쿼리 실행 중…' : q.durationMs !== null
                  ? `${q.rows.length.toLocaleString()}행 · ${q.durationMs.toLocaleString()} ms${q.hasMore ? ' · 추가 결과 있음' : ''}`
                  : '⌘ / Ctrl + Enter로 실행'}
              </Status>
              {q.columns.length > 0 && (
                <Button variant="ghost" size="sm" disabled={q.running}
                  title="현재 불러온 행만 CSV 파일로 저장합니다"
                  onClick={() => downloadResultCsv(q.columns, q.rows)}>
                  CSV 내보내기
                </Button>
              )}
              {q.running ? (
                <Button variant="ghost" size="sm" data-testid="query-cancel" onClick={q.cancel}>
                  Cancel
                </Button>
              ) : (
                <Button size="sm" data-testid="query-run" disabled={!draft.ready || q.sql.trim() === ''} onClick={() => void q.run()}>
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
              running={q.running}
              completed={q.durationMs !== null}
              truncated={q.truncated}
              onLoadMore={() => void q.loadMore()}
            />
          </>
        }
      />
    </Layout>
  )
}
