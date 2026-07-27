import styled from 'styled-components'
import { ConnectionForm, type ConnectionEditorState } from '../features/connections'
import { ErrorBanner } from '../shared/ui'

const Pane = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: auto;
  background: ${({ theme }) => theme.color.surface.bg};
`
const Header = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.space.md};
  padding: ${({ theme }) => `${theme.space.xs} ${theme.space.sm}`};
  border-bottom: 1px solid ${({ theme }) => theme.color.borders.strong};
  background: ${({ theme }) => theme.color.surface.panel};
  font-family: ${({ theme }) => theme.font.ui};
  font-size: ${({ theme }) => theme.fontSize.label};
  color: ${({ theme }) => theme.color.fg.dim};
`
const Title = styled.span`
  flex: 1;
`
const CloseButton = styled.button`
  padding: 4px 12px;
  border: none;
  border-radius: ${({ theme }) => theme.radius.md};
  background: transparent;
  color: ${({ theme }) => theme.color.fg.dim};
  font: inherit;
  cursor: pointer;
  &:hover {
    background: ${({ theme }) => theme.color.surface.panel};
    color: ${({ theme }) => theme.color.fg.primary};
  }
`

interface ConnectionSettingsPaneProps {
  editor: ConnectionEditorState
  /** 목록 게이트웨이 오류(저장·삭제 실패). */
  listError: string | null
  onClose: () => void
  /** 삭제. 열려 있는 연결이면 셸이 먼저 풀을 닫아야 하므로 셸이 넘겨 준다. */
  onDelete: () => void
}

/**
 * 메인 영역에 뜨는 연결 설정 화면. 모달이 아니라 패널인 이유는 사이드바가
 * 계속 보여야 하고(다른 연결로 바로 옮겨 갈 수 있다) `shared/ui`에 포커스 트랩
 * 프리미티브가 없기 때문이다. 열린 연결의 워크스페이스는 이 패널 뒤에서
 * 언마운트되지 않고 숨어 있다가 닫으면 그대로 돌아온다.
 */
export function ConnectionSettingsPane({
  editor,
  listError,
  onClose,
  onDelete,
}: ConnectionSettingsPaneProps) {
  return (
    <Pane data-testid="connection-settings">
      <Header>
        <Title>{editor.mode === 'new' ? '새 연결' : '연결 설정'}</Title>
        <CloseButton type="button" data-testid="settings-close" onClick={onClose}>
          닫기
        </CloseButton>
      </Header>
      {listError !== null && <ErrorBanner>{listError}</ErrorBanner>}
      <ConnectionForm
        key={editor.draft.id}
        draft={editor.draft}
        errors={editor.errors}
        isNew={editor.mode === 'new'}
        onChange={editor.change}
        onEngineChange={editor.changeEngine}
        onSave={() => void editor.save()}
        onDelete={onDelete}
        password={editor.password}
        onPasswordChange={editor.setPassword}
        hasSavedSecret={editor.hasSavedSecret}
        aiPassword={editor.aiPassword}
        onAiPasswordChange={editor.setAiPassword}
        hasSavedAiSecret={editor.hasSavedAiSecret}
        secretsPersistent={editor.secretsPersistent}
        onBrowseFile={editor.browseFile}
      />
    </Pane>
  )
}
