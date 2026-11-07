import { useCallback, useEffect, useRef, useState } from 'react'
import type { ConnectionConfig, EngineId } from '@shared/types/connection'
import type { ConnectionGateway } from '../../../gateways/ports/ConnectionGateway'
import type { ConnectionsState } from './useConnections'
import { applyEngine, emptyDraft, validateDraft } from './connectionForm'

export interface ConnectionEditorState {
  readonly draft: ConnectionConfig
  readonly errors: Readonly<Record<string, string>>
  /** `none`이면 편집 중인 레코드가 없다 — 호출자가 빈 상태를 그린다. */
  readonly mode: 'new' | 'edit' | 'none'
  readonly password: string
  readonly hasSavedSecret: boolean
  readonly aiPassword: string
  readonly hasSavedAiSecret: boolean
  readonly secretsPersistent: boolean
  readonly saving: boolean
  setPassword: (value: string) => void
  setAiPassword: (value: string) => void
  change: (patch: Partial<ConnectionConfig>) => void
  changeEngine: (engine: EngineId) => void
  startNew: () => void
  /** 편집을 끝낸다 — `mode`가 `none`으로 돌아가고 선택이 풀린다. */
  close: () => void
  save: () => Promise<void>
  remove: () => Promise<void>
  browseFile: () => void
}

/**
 * 연결 편집 화면의 상태 오케스트레이션. `ConnectionForm`은 순수 프레젠테이션이고
 * 초안·검증 오류·비밀번호 입력·저장 순서 같은 화면 레벨 규칙은 전부 여기 있다.
 * 목록(`ConnectionsState`)은 호출자가 소유해 주입한다 — 트리와 편집 패널이
 * 같은 목록 인스턴스를 공유해야 하기 때문이다.
 */
export function useConnectionEditor(
  gateway: ConnectionGateway,
  state: ConnectionsState,
): ConnectionEditorState {
  const [draft, setDraft] = useState<ConnectionConfig>(emptyDraft)
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({})
  const [mode, setMode] = useState<'new' | 'edit' | 'none'>('none')
  const [password, setPassword] = useState('')
  const [hasSavedSecret, setHasSavedSecret] = useState(false)
  const [aiPassword, setAiPassword] = useState('')
  const [hasSavedAiSecret, setHasSavedAiSecret] = useState(false)
  const [secretsPersistent, setSecretsPersistent] = useState(true)
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const editingId = useRef<string | null>(null)

  useEffect(() => {
    void gateway.secretsPersistent().then(setSecretsPersistent).catch(() => setSecretsPersistent(false))
  }, [gateway])

  useEffect(() => {
    if (state.selectedId === null || savingRef.current) return
    let alive = true
    const found = state.connections.find((c) => c.id === state.selectedId)
    if (found !== undefined) {
      if (editingId.current === found.id) return
      editingId.current = found.id
      setDraft(found)
      setErrors({})
      setMode('edit')
      setPassword('')
      setAiPassword('')
      void gateway.hasSecret(found.id).then((value) => { if (alive) setHasSavedSecret(value) }).catch(() => { if (alive) setHasSavedSecret(false) })
      void gateway.hasSecret(found.id, true).then((value) => { if (alive) setHasSavedAiSecret(value) }).catch(() => { if (alive) setHasSavedAiSecret(false) })
    }
    return () => { alive = false }
  }, [state.selectedId, state.connections, gateway])

  const clearSelection = state.clearSelection
  const startNew = useCallback(() => {
    const next = emptyDraft()
    editingId.current = next.id
    setDraft(next)
    setErrors({})
    setMode('new')
    setPassword('')
    setHasSavedSecret(false)
    setAiPassword('')
    setHasSavedAiSecret(false)
    clearSelection()
  }, [clearSelection])

  const close = useCallback(() => {
    editingId.current = null
    setMode('none')
    setErrors({})
    setPassword('')
    setAiPassword('')
    clearSelection()
  }, [clearSelection])

  const saveState = state.save
  const save = useCallback(async () => {
    if (savingRef.current) return
    const result = validateDraft(draft)
    if (!result.ok) {
      setErrors(result.errors)
      return
    }
    setErrors({})
    savingRef.current = true
    editingId.current = draft.id
    setSaving(true)
    try {
    if (!await saveState(draft)) return
    if (password !== '') {
      await gateway.setSecret(draft.id, password)
      setHasSavedSecret(true)
      setPassword('')
    }
    // AI 계정이 없는 저장이면 비밀번호를 쓰지 않는다. 필드는 계정명을 비우는
    // 순간 사라지지만 입력값은 이 화면 상태에 남아 있어서, 그대로 보내면 main이
    // 방금 지운 비밀(connection:save)을 다시 만들어 고아로 남긴다.
    const keepsAiAccount = draft.aiReadOnlyUsername !== null && draft.aiReadOnlyUsername !== ''
    if (keepsAiAccount && aiPassword !== '') {
      await gateway.setSecret(draft.id, aiPassword, true)
      setHasSavedAiSecret(true)
    }
    if (!keepsAiAccount) setHasSavedAiSecret(false)
    setAiPassword('')
    setMode('edit')
    } catch (error) {
      setErrors({ form: error instanceof Error ? error.message : '자격증명을 저장하지 못했습니다.' })
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }, [draft, password, aiPassword, gateway, saveState])

  const removeState = state.remove
  const remove = useCallback(async () => {
    if (await removeState(draft.id)) startNew()
  }, [draft.id, removeState, startNew])

  const change = useCallback((patch: Partial<ConnectionConfig>) => {
    setDraft((d) => ({ ...d, ...patch }))
  }, [])
  const changeEngine = useCallback((engine: EngineId) => {
    setDraft((d) => applyEngine(d, engine))
  }, [])
  const browseFile = useCallback(() => {
    void gateway.openFileDialog().then((path) => {
      if (path !== null) setDraft((d) => ({ ...d, database: path }))
    }).catch(() => setErrors({ form: '파일 선택 창을 열지 못했습니다.' }))
  }, [gateway])

  return {
    draft,
    errors,
    mode,
    password,
    hasSavedSecret,
    aiPassword,
    hasSavedAiSecret,
    secretsPersistent,
    saving,
    setPassword,
    setAiPassword,
    change,
    changeEngine,
    startNew,
    close,
    save,
    remove,
    browseFile,
  }
}
