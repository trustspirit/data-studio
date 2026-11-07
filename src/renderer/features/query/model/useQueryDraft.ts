import { useCallback, useEffect, useRef, useState } from 'react'
import type { WorkspaceGateway } from '../../../gateways/ports/WorkspaceGateway'

export function useQueryDraft(workspace: WorkspaceGateway | undefined, connectionId: string, serial: number | undefined, setSql: (value: string) => void) {
  const [ready, setReady] = useState(workspace === undefined || serial === undefined)
  const [error, setError] = useState<string | null>(null)
  const [persistent, setPersistent] = useState(true)
  const edited = useRef(false)
  const canSave = useRef(false)
  const latestText = useRef('')
  const revision = useRef(0)
  const unsaved = useRef(false)
  const pending = useRef(0)
  const persist = useCallback((sql: string) => {
    if (workspace === undefined || serial === undefined || !canSave.current) return
    const current = revision.current
    pending.current += 1
    void workspace.saveDraft(connectionId, serial, sql).then(() => {
      if (current === revision.current) { unsaved.current = false; setError(null) }
    }).catch(() => setError('SQL 초안을 저장하지 못했습니다. 앱을 닫기 전에 별도로 보관하세요.'))
      .finally(() => { pending.current -= 1 })
  }, [workspace, connectionId, serial])
  useEffect(() => {
    const protect = (event: BeforeUnloadEvent) => {
      if (pending.current === 0 && !unsaved.current) return
      event.preventDefault(); event.returnValue = ''
    }
    window.addEventListener('beforeunload', protect)
    return () => window.removeEventListener('beforeunload', protect)
  }, [])
  useEffect(() => {
    if (workspace === undefined || serial === undefined) return
    let alive = true
    canSave.current = false
    setReady(false)
    void workspace.load(connectionId).then((result) => {
      if (!alive) return
      if (!edited.current) setSql(result.workspace.drafts[serial] ?? '')
      setPersistent(result.persistent)
      canSave.current = true
      setReady(true)
      if (edited.current) persist(latestText.current)
    }).catch(() => {
      if (alive) { setError('SQL 초안을 복구하지 못했습니다. 원본을 덮어쓰지 않도록 자동 저장을 중단했습니다.'); setReady(true) }
    })
    return () => { alive = false }
  }, [workspace, connectionId, serial, setSql, persist])

  const change = useCallback((sql: string) => {
    edited.current = true
    latestText.current = sql
    revision.current += 1
    unsaved.current = workspace !== undefined
    setSql(sql)
    if (workspace === undefined || serial === undefined || !ready || !canSave.current) return
    persist(sql)
  }, [workspace, serial, ready, setSql, persist])
  return { ready, error, persistent, change }
}
