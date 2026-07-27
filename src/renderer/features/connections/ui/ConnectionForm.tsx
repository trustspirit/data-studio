import { useState } from 'react'
import styled from 'styled-components'
import {
  IMPLEMENTED_ENGINE_IDS,
  TLS_MODES,
  type ConnectionConfig,
  type EngineId,
} from '@shared/types/connection'
import { Button, Panel, Select, TextField } from '../../../shared/ui'

const Body = styled(Panel)`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.space.md};
  padding: ${({ theme }) => theme.space.lg};
  margin: ${({ theme }) => theme.space.md};
  max-width: 680px;
  width: calc(100% - ${({ theme }) => theme.space.lg});
`
const FormTitle = styled.h2`
  margin: 0;
  font-family: ${({ theme }) => theme.font.ui};
  font-size: ${({ theme }) => theme.fontSize.heading};
  font-weight: 600;
  color: ${({ theme }) => theme.color.text.primary};
`
const SectionLabel = styled.div`
  margin-top: ${({ theme }) => theme.space.xs};
  padding-top: ${({ theme }) => theme.space.md};
  border-top: 1px solid ${({ theme }) => theme.color.border.soft};
  font-family: ${({ theme }) => theme.font.ui};
  font-size: ${({ theme }) => theme.fontSize.label};
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: ${({ theme }) => theme.color.text.faint};
`
const Row = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.space.md};
  align-items: flex-end;
  & > * {
    flex: 1;
  }
`
const Actions = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.space.sm};
  margin-top: ${({ theme }) => theme.space.xs};
  padding-top: ${({ theme }) => theme.space.md};
  border-top: 1px solid ${({ theme }) => theme.color.border.soft};
`
const Warn = styled.div`
  color: ${({ theme }) => theme.color.intent.warning};
  font-family: ${({ theme }) => theme.font.ui};
  font-size: ${({ theme }) => theme.fontSize.body};
`
const Hint = styled.div`
  color: ${({ theme }) => theme.color.text.dim};
  font-family: ${({ theme }) => theme.font.ui};
  font-size: ${({ theme }) => theme.fontSize.body};
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
  aiPassword: string
  onAiPasswordChange: (value: string) => void
  hasSavedAiSecret: boolean
  secretsPersistent: boolean
  onBrowseFile: () => void
}

const engineOptions = IMPLEMENTED_ENGINE_IDS.map((id) => ({ value: id, label: id }))
const tlsOptions = TLS_MODES.map((m) => ({ value: m, label: m }))

/**
 * 파일 경로 기반 엔진인가 (Host/Port/User/Password 대신 파일 선택 UI를 쓴다).
 * `defaultPort(engine) === null`을 재사용하지 않는다 — dynamodb도 포트가
 * 없지만 파일 엔진은 아니라서, 그 조건을 쓰면 나중에 dynamodb를 구현할 때
 * 함정에 빠진다.
 */
function isFilePathEngine(engine: EngineId): boolean {
  return engine === 'sqlite'
}

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
  aiPassword,
  onAiPasswordChange,
  hasSavedAiSecret,
  secretsPersistent,
  onBrowseFile,
}: Props) {
  const [confirming, setConfirming] = useState(false)
  const fileEngine = isFilePathEngine(draft.engine)

  return (
    <Body>
      <FormTitle>{isNew ? '새 연결' : draft.name || '연결 편집'}</FormTitle>
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
        {!fileEngine && (
          <Select
            label="TLS"
            value={draft.tlsMode}
            onValueChange={(v) => onChange({ tlsMode: v as ConnectionConfig['tlsMode'] })}
            options={tlsOptions}
          />
        )}
      </Row>
      <SectionLabel>Connection</SectionLabel>
      {!fileEngine && (
        <Row>
          <TextField
            label="Host"
            value={draft.host}
            onValueChange={(host) => onChange({ host })}
            {...errorProp(errors, 'host')}
          />
          <TextField
            label="Port"
            type="number"
            value={String(draft.port)}
            onValueChange={(v) => onChange({ port: Number(v) })}
            {...errorProp(errors, 'port')}
          />
        </Row>
      )}
      {fileEngine ? (
        <Row>
          <TextField
            label="Database file"
            value={draft.database}
            onValueChange={(database) => onChange({ database })}
            {...errorProp(errors, 'database')}
          />
          <Button variant="ghost" onClick={onBrowseFile}>
            Browse…
          </Button>
        </Row>
      ) : (
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
      )}
      {!fileEngine && (
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
      <SectionLabel>AI Access</SectionLabel>
      <TextField
        label="AI read-only user"
        value={draft.aiReadOnlyUsername ?? ''}
        onValueChange={(v) => onChange({ aiReadOnlyUsername: v === '' ? null : v })}
      />
      {draft.aiReadOnlyUsername === null ? (
        <Warn>AI 읽기 전용 계정 없음 — AI가 사용자 계정을 공유합니다.</Warn>
      ) : (
        !fileEngine && (
          <>
            <TextField
              label="AI account password"
              type="password"
              value={aiPassword}
              onValueChange={onAiPasswordChange}
              placeholder={hasSavedAiSecret ? '●●●●●●' : ''}
            />
            {hasSavedAiSecret ? (
              <Hint>저장됨 — 비우면 유지, 입력하면 교체됩니다.</Hint>
            ) : (
              <Hint>연결을 열 때 AI가 이 계정으로 별도 접속합니다.</Hint>
            )}
          </>
        )
      )}
      <Actions>
        <Button onClick={onSave}>Save</Button>
        {!isNew &&
          (confirming ? (
            <>
              <Button variant="danger" onClick={onDelete}>
                Confirm delete
              </Button>
              <Button variant="ghost" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <Button variant="ghost" onClick={() => setConfirming(true)}>
              Delete
            </Button>
          ))}
      </Actions>
    </Body>
  )
}
