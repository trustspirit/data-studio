import { useEffect, useState } from 'react'
import styled from 'styled-components'
import { useGateways } from './GatewayProvider'
import { useConnections, useConnectionEditor } from '../features/connections'
import { AuditView } from '../features/audit'
import { ConnectionRow, ConnectionTree, type ConnectionRowState } from '../entities/connection-tree'
import { ConnectionBranch } from './ConnectionBranch'
import { WorkspaceHost } from './WorkspaceHost'
import { ConnectionSettingsPane } from './ConnectionSettingsPane'
import { ConnectionInvite } from './ConnectionInvite'
import { useOpenConnections } from './model/useOpenConnections'
import { EmptyState } from '../shared/ui'

const Layout = styled.div`
  display: grid;
  grid-template-columns: ${({ theme }) => `${theme.size.rail} ${theme.size.sidebar} 1fr`};
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
const Content = styled.div`
  position: relative;
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
  const gateways = useGateways()
  const conns = useConnections(gateways.connection)
  const editor = useConnectionEditor(gateways.connection, conns)
  const shell = useOpenConnections(gateways.connection)
  const { forget } = shell

  useEffect(() => {
    // 목록에서 사라진 연결(다른 곳에서 삭제됨)의 셸 상태를 버린다.
    for (const id of Object.keys(shell.open)) {
      if (!conns.connections.some((c) => c.id === id)) forget(id)
    }
  }, [conns.connections, shell.open, forget])

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
                selected={shell.selection[c.id] ?? null}
                reloadToken={schemaTokens[c.id] ?? 0}
                onSchemasLoaded={(names) => noteSchemas(c.id, names)}
                onSelect={(sel) => {
                  shell.setSelection(c.id, sel)
                  setTab('workspace')
                  editor.close()
                  setInviteId(null)
                  shell.setActive(c.id)
                }}
              />
            )}
          </ConnectionRow>
        )
      })}
    </ConnectionTree>
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
      {sidebar}
      <Content>
        <Layer hidden={mainView !== 'workspace'} aria-hidden={mainView !== 'workspace'}>
          {shell.activeId !== null ? (
            <WorkspaceHost
              connections={conns.connections}
              open={shell.open}
              activeId={shell.activeId}
              gateway={gateways.operation}
              ai={gateways.ai}
              selection={shell.selection}
              onSelectionChange={shell.setSelection}
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
    </Layout>
  )
}
