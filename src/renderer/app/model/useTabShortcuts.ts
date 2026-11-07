import { useEffect } from 'react'
import { documentKey } from '../../entities/document'
import type { TabSet } from './useDocumentTabs'

interface TabShortcutArgs {
  /** 활성 연결의 워크스페이스만 켠다 — 숨은 워크스페이스가 키를 가로채면 안 된다. */
  enabled: boolean
  tabs: TabSet
  onRequestClose: (key: string) => void
  onActivate: (key: string) => void
}

export function useTabShortcuts({ enabled, tabs, onRequestClose, onActivate }: TabShortcutArgs): void {
  useEffect(() => {
    if (!enabled) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.metaKey && !e.ctrlKey) return
      const keys = tabs.documents.map(documentKey)
      if (keys.length === 0) return
      const index = tabs.activeKey === null ? -1 : keys.indexOf(tabs.activeKey)

      if (!e.altKey && e.key.toLowerCase() === 'w') {
        if (tabs.activeKey === null) return
        e.preventDefault()
        onRequestClose(tabs.activeKey)
        return
      }
      if (!e.altKey) return
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
      e.preventDefault()
      // 양끝에서 순환한다 — 탭이 둘일 때 같은 키로 오갈 수 있다.
      const step = e.key === 'ArrowRight' ? 1 : -1
      const next = keys[(index + step + keys.length) % keys.length]
      if (next !== undefined) onActivate(next)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [enabled, tabs, onRequestClose, onActivate])
}
