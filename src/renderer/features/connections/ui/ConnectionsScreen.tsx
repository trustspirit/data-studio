import { useEffect, useState } from 'react'
import styled from 'styled-components'
import type { ConnectionConfig, EngineId } from '@shared/types/connection'
import { useGateways } from '../../../app/GatewayProvider'
import { useConnections } from '../model/useConnections'
import { applyEngine, emptyDraft, validateDraft } from '../model/connectionForm'
import { ConnectionList } from './ConnectionList'
import { ConnectionForm } from './ConnectionForm'

const Layout = styled.div`
  display: grid;
  grid-template-columns: 240px 1fr;
  height: 100vh;
  background: ${({ theme }) => theme.color.winBg};
  color: ${({ theme }) => theme.color.text};
`
const Detail = styled.div`
  overflow: auto;
`
const Empty = styled.div`
  padding: 24px;
  color: ${({ theme }) => theme.color.textDim};
  font: ${({ theme }) => theme.font.ui};
`
const Banner = styled.div`
  margin: 12px;
  padding: 8px 12px;
  border-radius: 6px;
  background: ${({ theme }) => theme.color.red};
  color: #fff;
  font: ${({ theme }) => theme.font.ui};
  font-size: 13px;
`

export function ConnectionsScreen() {
  const gateways = useGateways()
  const state = useConnections(gateways.connection)
  const [draft, setDraft] = useState<ConnectionConfig>(emptyDraft)
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({})
  const [mode, setMode] = useState<'new' | 'edit' | 'none'>('none')

  useEffect(() => {
    if (state.selectedId === null) return
    const found = state.connections.find((c) => c.id === state.selectedId)
    if (found !== undefined) {
      setDraft(found)
      setErrors({})
      setMode('edit')
    }
  }, [state.selectedId, state.connections])

  const startNew = () => {
    setDraft(emptyDraft())
    setErrors({})
    setMode('new')
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
        {state.error !== null && <Banner>{state.error}</Banner>}
        {mode === 'none' ? (
          <Empty>왼쪽에서 연결을 고르거나 사이드바의 추가 버튼으로 새로 만드세요.</Empty>
        ) : (
          <ConnectionForm
            draft={draft}
            errors={errors}
            isNew={mode === 'new'}
            onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))}
            onEngineChange={(engine: EngineId) => setDraft((d) => applyEngine(d, engine))}
            onSave={() => void onSave()}
            onDelete={() => void onDelete()}
          />
        )}
      </Detail>
    </Layout>
  )
}
