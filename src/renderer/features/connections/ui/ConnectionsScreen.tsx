import { useEffect, useState } from 'react'
import styled from 'styled-components'
import { IMPLEMENTED_ENGINE_IDS, type ConnectionConfig, type EngineId } from '@shared/types/connection'
import { useGateways } from '../../../app/GatewayProvider'
import { useConnections } from '../model/useConnections'
import { applyEngine, emptyDraft, validateDraft } from '../model/connectionForm'
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
  const [draft, setDraft] = useState<ConnectionConfig>(emptyDraft)
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({})
  const [mode, setMode] = useState<'new' | 'edit' | 'none'>('none')
  const [password, setPassword] = useState('')
  const [hasSavedSecret, setHasSavedSecret] = useState(false)
  const [secretsPersistent, setSecretsPersistent] = useState(true)

  useEffect(() => {
    void gateways.connection.secretsPersistent().then(setSecretsPersistent)
  }, [gateways.connection])

  useEffect(() => {
    if (state.selectedId === null) return
    const found = state.connections.find((c) => c.id === state.selectedId)
    if (found !== undefined) {
      setDraft(found)
      setErrors({})
      setMode('edit')
      setPassword('')
      void gateways.connection.hasSecret(found.id).then(setHasSavedSecret)
    }
  }, [state.selectedId, state.connections, gateways.connection])

  const startNew = () => {
    setDraft(emptyDraft())
    setErrors({})
    setMode('new')
    setPassword('')
    setHasSavedSecret(false)
    state.clearSelection()
  }

  const onSave = async () => {
    const result = validateDraft(draft)
    if (!result.ok) {
      setErrors(result.errors)
      return
    }
    setErrors({})
    await state.save(draft)
    if (password !== '') {
      await gateways.connection.setSecret(draft.id, password)
      setHasSavedSecret(true)
      setPassword('')
    }
    setMode('edit')
  }

  const onDelete = async () => {
    await state.remove(draft.id)
    startNew()
  }

  return (
    <Layout>
      <ConnectionList
        connections={state.connections}
        selectedId={state.selectedId}
        onSelect={state.select}
        onNew={startNew}
      />
      <Detail>
        {state.error !== null && <ErrorBanner>{state.error}</ErrorBanner>}
        {mode === 'none' ? (
          <EmptyState
            title="왼쪽에서 연결을 고르거나 사이드바의 추가 버튼으로 새로 만드세요."
            hint={IMPLEMENTED_ENGINE_IDS.join(' · ')}
          />
        ) : (
          <ConnectionForm
            key={draft.id}
            draft={draft}
            errors={errors}
            isNew={mode === 'new'}
            onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))}
            onEngineChange={(engine: EngineId) => setDraft((d) => applyEngine(d, engine))}
            onSave={() => void onSave()}
            onDelete={() => void onDelete()}
            password={password}
            onPasswordChange={setPassword}
            hasSavedSecret={hasSavedSecret}
            secretsPersistent={secretsPersistent}
            onBrowseFile={() => {
              void gateways.connection.openFileDialog().then((path) => {
                if (path !== null) setDraft((d) => ({ ...d, database: path }))
              })
            }}
          />
        )}
      </Detail>
    </Layout>
  )
}
