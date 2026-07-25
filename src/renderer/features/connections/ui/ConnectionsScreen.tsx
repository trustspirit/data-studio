import styled from 'styled-components'
import { IMPLEMENTED_ENGINE_IDS } from '@shared/types/connection'
import { useGateways } from '../../../app/GatewayProvider'
import { useConnections } from '../model/useConnections'
import { useConnectionEditor } from '../model/useConnectionEditor'
import { EmptyState, ErrorBanner } from '../../../shared/ui'
import { ConnectionList } from './ConnectionList'
import { ConnectionForm } from './ConnectionForm'

const Layout = styled.div`
  display: grid;
  grid-template-columns: ${({ theme }) => theme.size.sidebar} 1fr;
  height: 100%;
  min-height: 0;
  background: ${({ theme }) => theme.color.winBg};
  color: ${({ theme }) => theme.color.text};
`
const Detail = styled.div`
  min-width: 0;
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
`

export function ConnectionsScreen() {
  const gateways = useGateways()
  const state = useConnections(gateways.connection)
  const editor = useConnectionEditor(gateways.connection, state)

  return (
    <Layout>
      <ConnectionList
        connections={state.connections}
        selectedId={state.selectedId}
        onSelect={state.select}
        onNew={editor.startNew}
      />
      <Detail>
        {state.error !== null && <ErrorBanner>{state.error}</ErrorBanner>}
        {editor.mode === 'none' ? (
          <EmptyState
            title="왼쪽에서 연결을 고르거나 사이드바의 추가 버튼으로 새로 만드세요."
            hint={IMPLEMENTED_ENGINE_IDS.join(' · ')}
          />
        ) : (
          <ConnectionForm
            key={editor.draft.id}
            draft={editor.draft}
            errors={editor.errors}
            isNew={editor.mode === 'new'}
            onChange={editor.change}
            onEngineChange={editor.changeEngine}
            onSave={() => void editor.save()}
            onDelete={() => void editor.remove()}
            password={editor.password}
            onPasswordChange={editor.setPassword}
            hasSavedSecret={editor.hasSavedSecret}
            aiPassword={editor.aiPassword}
            onAiPasswordChange={editor.setAiPassword}
            hasSavedAiSecret={editor.hasSavedAiSecret}
            secretsPersistent={editor.secretsPersistent}
            onBrowseFile={editor.browseFile}
          />
        )}
      </Detail>
    </Layout>
  )
}
