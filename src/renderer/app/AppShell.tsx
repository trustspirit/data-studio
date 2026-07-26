import { useEffect, useState } from 'react'
import styled from 'styled-components'
import { useGateways } from './GatewayProvider'
import { useConnections, useConnectionEditor } from '../features/connections'
import { AuditView } from '../features/audit'
import { ConnectionRow, ConnectionTree, type ConnectionRowState } from '../entities/connection-tree'
import type { TableSelection } from '../entities/schema-tree'
import { ConnectionBranch } from './ConnectionBranch'
import { WorkspaceHost } from './WorkspaceHost'
import { ConnectionSettingsPane } from './ConnectionSettingsPane'
import { ConnectionInvite } from './ConnectionInvite'
import { useOpenConnections } from './model/useOpenConnections'
import { useDocumentTabs } from './model/useDocumentTabs'
import { EmptyState, SplitPane } from '../shared/ui'
import { readPanelSize, writePanelSize } from '../shared/lib'
import { darkTheme } from '../shared/theme'

const Layout = styled.div`
  display: grid;
  grid-template-columns: ${({ theme }) => `${theme.size.rail} 1fr`};
  height: 100%;
  min-height: 0;
  background: ${({ theme }) => theme.color.winBg};
  color: ${({ theme }) => theme.color.text};
`
const Rail = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: ${({ theme }) => theme.space.xs};
  padding: ${({ theme }) => theme.space.sm} 0;
  background: ${({ theme }) => theme.color.toolbar};
  border-right: 1px solid ${({ theme }) => theme.color.border};
  overflow: hidden;
`
const RailButton = styled.button<{ $active: boolean }>`
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  padding: 0;
  border: none;
  border-radius: ${({ theme }) => theme.radius.md};
  cursor: pointer;
  color: ${({ theme, $active }) => ($active ? theme.color.text : theme.color.textDim)};
  background: ${({ theme, $active }) => ($active ? theme.color.panel : 'transparent')};
  &:hover {
    color: ${({ theme }) => theme.color.text};
  }
  /* 활성 탭 표시 — 레일 왼쪽 가장자리의 액센트 바 */
  &::before {
    content: '';
    position: absolute;
    left: -8px;
    top: 8px;
    bottom: 8px;
    width: 2px;
    border-radius: 1px;
    background: ${({ theme, $active }) => ($active ? theme.color.accent : 'transparent')};
  }
`

function WorkspaceIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
      <rect x="3" y="3.5" width="14" height="13" rx="1.8" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 3.5v13" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 8.5h9" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}
function AuditIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
      <rect x="4" y="2.8" width="12" height="14.4" rx="1.6" stroke="currentColor" strokeWidth="1.5" />
      <path d="M7 6.6h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M7 10h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M7 13.4h3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}
/**
 * 사이드바가 들어가는 자리. 폭은 이제 `SplitPane`이 정하므로 트리 자신이 들고
 * 있던 고정 폭(`Sidebar`의 flex-basis·width)을 여기서 무효화한다 — 그러지
 * 않으면 세로 flex 컨테이너 안에서 그 240px가 **높이**로 해석된다.
 */
const SidebarSlot = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  min-width: 0;
  > * {
    flex: 1 1 auto;
    width: auto;
    min-height: 0;
  }
`
const Content = styled.div`
  position: relative;
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
`
/**
 * 설정 패널이나 Audit이 앞에 와도 워크스페이스는 언마운트하지 않고 숨긴다.
 * 언마운트하면 작성 중인 SQL과 그리드 편집이 사라진다 — 설정을 잠깐 보고
 * 돌아오는 흐름에서 그건 데이터 손실이다.
 */
const Layer = styled.div`
  flex: 1;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  &[hidden] {
    display: none;
  }
`

export function AppShell() {
  const [tab, setTab] = useState<'workspace' | 'audit'>('workspace')
  /** 연결별 스키마 이름. 가지가 접혀 언마운트돼도 디자이너가 쓸 수 있게 셸이 들고 있는다. */
  const [schemaNames, setSchemaNames] = useState<Readonly<Record<string, readonly string[]>>>({})
  /** DDL이 통과할 때마다 올라가는 연결별 카운터 — 가지가 이걸 보고 다시 읽는다. */
  const [schemaTokens, setSchemaTokens] = useState<Readonly<Record<string, number>>>({})
  /**
   * 트리에서 마지막으로 고른 행. 문서 탭과는 다른 것이다 — 한 번 클릭은 열지
   * 않으므로(스치는 클릭이 프로덕션 SELECT가 되면 안 된다) 활성 문서만으로는
   * 클릭에 아무 반응이 없다. 이 값이 그 클릭의 유일한 피드백이다.
   */
  const [highlight, setHighlight] = useState<Readonly<Record<string, TableSelection | null>>>({})
  const [sidebarSize, setSidebarSize] = useState(() =>
    readPanelSize('sidebar', darkTheme.size.sidebarDefault),
  )
  const gateways = useGateways()
  const conns = useConnections(gateways.connection)
  const editor = useConnectionEditor(gateways.connection, conns)
  const shell = useOpenConnections(gateways.connection)
  const tabs = useDocumentTabs()
  const { forget } = shell
  // 훅이 돌려주는 객체는 매 렌더 새로 만들어진다 — effect deps에는 그 안의
  // 안정된 콜백만 넣는다. 객체를 넣으면 effect가 매 렌더 다시 돈다.
  const { tabs: tabSets, forget: forgetTabs, ensureDefaults } = tabs

  useEffect(() => {
    // 목록에서 사라진 연결(다른 곳에서 삭제됨)의 셸 상태를 버린다.
    for (const id of Object.keys(shell.open)) {
      if (!conns.connections.some((c) => c.id === id)) forget(id)
    }
  }, [conns.connections, shell.open, forget])

  useEffect(() => {
    // 닫힌 연결의 문서와 트리 강조가 남으면 다시 열었을 때 사라진 테이블을
    // 가리킬 수 있다. 닫기 실패로 엔트리가 살아 있으면 그대로 둔다.
    const gone = (id: string) => shell.open[id] === undefined
    for (const id of Object.keys(tabSets)) {
      if (gone(id)) forgetTabs(id)
    }
    setHighlight((cur) => {
      const stale = Object.keys(cur).filter(gone)
      if (stale.length === 0) return cur
      const rest = { ...cur }
      for (const id of stale) delete rest[id]
      return rest
    })
  }, [shell.open, tabSets, forgetTabs])

  useEffect(() => {
    // 비-SQL 엔진은 열 수 있는 문서가 싱글턴 하나뿐이다 — 접속하자마자 열어
    // 주지 않으면 빈 화면만 남는다. ensureDefaults는 ref로 한 번만 연다.
    for (const [id, entry] of Object.entries(shell.open)) {
      if (entry.state === 'ready') ensureDefaults(id, entry.capabilities)
    }
  }, [shell.open, ensureDefaults])

  /** 사이드바에서 고른, 아직 접속하지 않은 연결. */
  const [inviteId, setInviteId] = useState<string | null>(null)
  const inviteConn = inviteId === null ? null : (conns.connections.find((c) => c.id === inviteId) ?? null)
  // 접속에 성공하면 초대는 저절로 사라지고, 실패하면 사유를 안은 채 남는다 —
  // 파생값이라 지우는 effect가 필요 없다. 목록에서 삭제된 연결도 같은 이유로
  // 스스로 정리된다.
  const showInvite = inviteConn !== null && shell.open[inviteConn.id]?.state !== 'ready'

  const editing = editor.mode !== 'none'
  const mainView = tab === 'audit'
    ? 'audit'
    : editing
      ? 'settings'
      : showInvite
        ? 'invite'
        : 'workspace'

  const startNew = () => {
    setTab('workspace')
    editor.startNew()
  }
  const openSettings = (id: string) => {
    setTab('workspace')
    conns.select(id)
  }
  const noteSchemas = (id: string, names: readonly string[]) => {
    setSchemaNames((cur) => {
      const prev = cur[id]
      if (prev !== undefined && prev.length === names.length && prev.every((n, i) => n === names[i])) {
        return cur
      }
      return { ...cur, [id]: names }
    })
  }
  const noteSchemaChanged = (id: string) => {
    setSchemaTokens((cur) => ({ ...cur, [id]: (cur[id] ?? 0) + 1 }))
  }
  const deleteConnection = async () => {
    const id = editor.draft.id
    // 열려 있는 연결을 그냥 지우면 풀이 남는다. 닫기가 삭제보다 먼저다.
    if (shell.open[id] !== undefined) await shell.closeConnection(id)
    await editor.remove()
  }
  /** 트리에서 무언가를 열 때 공통으로 하는 일 — 워크스페이스를 앞으로 가져온다. */
  const focusWorkspace = (id: string) => {
    setTab('workspace')
    editor.close()
    setInviteId(null)
    shell.setActive(id)
  }

  const sidebar = (
    <ConnectionTree isEmpty={conns.connections.length === 0} onNew={startNew}>
      {conns.connections.map((c) => {
        const state: ConnectionRowState = shell.open[c.id]?.state ?? 'closed'
        return (
          <ConnectionRow
            key={c.id}
            id={c.id}
            name={c.name}
            engine={c.engine}
            state={state}
            expanded={shell.expanded[c.id] === true}
            active={
              (shell.activeId === c.id && mainView === 'workspace') ||
              (mainView === 'invite' && inviteId === c.id)
            }
            error={shell.open[c.id]?.error}
            onToggle={() => shell.toggleExpanded(c.id)}
            // 행 클릭은 접속하지 않는다 — 사이드바에서 스치듯 누른 클릭이
            // 프로덕션 접속이 되면 안 된다. 접속은 '연결' 버튼만 한다.
            onRowClick={() => {
              setTab('workspace')
              editor.close()
              if (state === 'ready') {
                setInviteId(null)
                shell.setActive(c.id)
              } else {
                // 펼칠 것이 없는 연결이다. 메인에 무엇을 골랐는지 띄우고 접속을
                // 한 번 더 권한다.
                setInviteId(c.id)
              }
            }}
            onConnect={() => {
              setTab('workspace')
              editor.close()
              void shell.openConnection(c.id)
            }}
            onClose={() => void shell.closeConnection(c.id)}
            onSettings={() => openSettings(c.id)}
          >
            {state === 'ready' && (
              <ConnectionBranch
                key={c.id}
                gateway={gateways.operation}
                connectionId={c.id}
                selected={highlight[c.id] ?? null}
                reloadToken={schemaTokens[c.id] ?? 0}
                onSchemasLoaded={(names) => noteSchemas(c.id, names)}
                // 한 번 클릭은 고르기만 한다. 문서를 여는 것은 더블클릭·Enter다.
                onSelect={(sel) => {
                  setHighlight((cur) => ({ ...cur, [c.id]: sel }))
                  setTab('workspace')
                  editor.close()
                  setInviteId(null)
                  shell.setActive(c.id)
                }}
                onOpen={(sel) => {
                  setHighlight((cur) => ({ ...cur, [c.id]: sel }))
                  focusWorkspace(c.id)
                  tabs.open(c.id, { kind: 'table', schema: sel.schema, table: sel.table })
                }}
                onOpenSchema={(schema) => {
                  focusWorkspace(c.id)
                  tabs.open(c.id, { kind: 'er', schema })
                }}
              />
            )}
          </ConnectionRow>
        )
      })}
    </ConnectionTree>
  )

  const content = (
    <Content>
      <Layer hidden={mainView !== 'workspace'} aria-hidden={mainView !== 'workspace'}>
        {shell.activeId !== null ? (
          <WorkspaceHost
            connections={conns.connections}
            open={shell.open}
            activeId={shell.activeId}
            gateway={gateways.operation}
            ai={gateways.ai}
            tabs={tabSets}
            onOpenDocument={tabs.open}
            onCloseDocument={tabs.close}
            onActivateDocument={tabs.activate}
            onNewQuery={(id) => tabs.open(id, { kind: 'query', serial: tabs.nextQuerySerial(id) })}
            schemas={schemaNames}
            onSchemaChanged={noteSchemaChanged}
          />
        ) : (
          <EmptyState
            title={
              conns.connections.length === 0
                ? '연결이 없습니다 — 사이드바의 + 로 추가하세요.'
                : '사이드바에서 연결을 골라 접속하세요.'
            }
          />
        )}
      </Layer>
      {mainView === 'invite' && inviteConn !== null && (
        <ConnectionInvite
          connection={inviteConn}
          connecting={shell.open[inviteConn.id]?.state === 'connecting'}
          error={shell.open[inviteConn.id]?.error ?? null}
          onConnect={() => void shell.openConnection(inviteConn.id)}
          onSettings={() => openSettings(inviteConn.id)}
        />
      )}
      {mainView === 'settings' && (
        <ConnectionSettingsPane
          editor={editor}
          listError={conns.error}
          onClose={editor.close}
          onDelete={() => void deleteConnection()}
        />
      )}
      {mainView === 'audit' && <AuditView gateway={gateways.operation} />}
    </Content>
  )

  return (
    <Layout>
      <Rail>
        <RailButton
          type="button"
          aria-label="Workspace"
          title="Workspace"
          $active={tab === 'workspace'}
          onClick={() => setTab('workspace')}
        >
          <WorkspaceIcon />
        </RailButton>
        <RailButton
          type="button"
          aria-label="Audit"
          title="Audit"
          $active={tab === 'audit'}
          onClick={() => setTab('audit')}
        >
          <AuditIcon />
        </RailButton>
      </Rail>
      <SplitPane
        direction="row"
        anchor="first"
        size={sidebarSize}
        min={darkTheme.size.sidebarMin}
        max={darkTheme.size.sidebarMax}
        onSizeChange={(size) => {
          setSidebarSize(size)
          writePanelSize('sidebar', size)
        }}
        label="사이드바 크기"
        testId="split-sidebar"
        first={<SidebarSlot>{sidebar}</SidebarSlot>}
        second={content}
      />
    </Layout>
  )
}
