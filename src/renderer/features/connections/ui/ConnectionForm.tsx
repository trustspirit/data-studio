import { useState } from 'react'
import styled from 'styled-components'
import {
  ENGINE_IDS,
  TLS_MODES,
  type ConnectionConfig,
  type EngineId,
} from '@shared/types/connection'
import { defaultPort } from '../model/enginePorts'
import { Button, Panel, Select, TextField } from '../../../shared/ui'

const Body = styled(Panel)`
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  margin: 12px;
`
const Row = styled.div`
  display: flex;
  gap: 12px;
  & > * {
    flex: 1;
  }
`
const Actions = styled.div`
  display: flex;
  gap: 8px;
  margin-top: 8px;
`
const Warn = styled.div`
  color: ${({ theme }) => theme.color.orange};
  font: ${({ theme }) => theme.font.ui};
  font-size: 12px;
`
const Hint = styled.div`
  color: ${({ theme }) => theme.color.textDim};
  font: ${({ theme }) => theme.font.ui};
  font-size: 12px;
`

interface Props {
  draft: ConnectionConfig
  errors: Readonly<Record<string, string>>
  isNew: boolean
  onChange: (patch: Partial<ConnectionConfig>) => void
  onEngineChange: (engine: EngineId) => void
  onSave: () => void
  onDelete: () => void
  password: string
  onPasswordChange: (value: string) => void
  hasSavedSecret: boolean
  secretsPersistent: boolean
}

const engineOptions = ENGINE_IDS.map((id) => ({ value: id, label: id }))
const tlsOptions = TLS_MODES.map((m) => ({ value: m, label: m }))

/**
 * `errors[key]`는 (noUncheckedIndexedAccess로) `string | undefined`다.
 * TextField/Select의 `error?: string`은 exactOptionalPropertyTypes 하에서
 * `undefined`를 명시적으로 넣는 걸 허용하지 않으므로, 없을 땐 프롭 자체를
 * 생략해야 한다.
 */
function errorProp(errors: Readonly<Record<string, string>>, key: string): { error?: string } {
  const message = errors[key]
  return message === undefined ? {} : { error: message }
}

export function ConnectionForm({
  draft,
  errors,
  isNew,
  onChange,
  onEngineChange,
  onSave,
  onDelete,
  password,
  onPasswordChange,
  hasSavedSecret,
  secretsPersistent,
}: Props) {
  const [confirming, setConfirming] = useState(false)
  const showPort = defaultPort(draft.engine) !== null

  return (
    <Body>
      <TextField
        label="Name"
        value={draft.name}
        onValueChange={(name) => onChange({ name })}
        {...errorProp(errors, 'name')}
      />
      <Row>
        <Select
          label="Engine"
          value={draft.engine}
          onValueChange={(v) => onEngineChange(v as EngineId)}
          options={engineOptions}
        />
        <Select
          label="TLS"
          value={draft.tlsMode}
          onValueChange={(v) => onChange({ tlsMode: v as ConnectionConfig['tlsMode'] })}
          options={tlsOptions}
        />
      </Row>
      <Row>
        <TextField
          label="Host"
          value={draft.host}
          onValueChange={(host) => onChange({ host })}
          {...errorProp(errors, 'host')}
        />
        {showPort && (
          <TextField
            label="Port"
            type="number"
            value={String(draft.port)}
            onValueChange={(v) => onChange({ port: Number(v) })}
            {...errorProp(errors, 'port')}
          />
        )}
      </Row>
      <Row>
        <TextField
          label="Database"
          value={draft.database}
          onValueChange={(database) => onChange({ database })}
          {...errorProp(errors, 'database')}
        />
        <TextField
          label="User"
          value={draft.username}
          onValueChange={(username) => onChange({ username })}
          {...errorProp(errors, 'username')}
        />
      </Row>
      {showPort && (
        <>
          <TextField
            label="Password"
            type="password"
            value={password}
            onValueChange={onPasswordChange}
            placeholder={hasSavedSecret ? '●●●●●●' : ''}
          />
          {hasSavedSecret && <Hint>저장됨 — 비우면 유지, 입력하면 교체됩니다.</Hint>}
          {!secretsPersistent && (
            <Warn>이 기기는 재시작 시 비밀번호를 다시 입력해야 합니다.</Warn>
          )}
        </>
      )}
      <TextField
        label="AI read-only user"
        value={draft.aiReadOnlyUsername ?? ''}
        onValueChange={(v) => onChange({ aiReadOnlyUsername: v === '' ? null : v })}
      />
      {draft.aiReadOnlyUsername === null && (
        <Warn>AI 읽기 전용 계정 없음 — AI가 사용자 계정을 공유합니다.</Warn>
      )}
      <Actions>
        <Button onClick={onSave}>Save</Button>
        {!isNew &&
          (confirming ? (
            <>
              <Button variant="danger" onClick={onDelete}>
                Confirm delete
              </Button>
              <Button variant="secondary" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <Button variant="secondary" onClick={() => setConfirming(true)}>
              Delete
            </Button>
          ))}
      </Actions>
    </Body>
  )
}
