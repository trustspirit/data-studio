import { useEffect, useRef } from 'react'
import styled from 'styled-components'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { defaultKeymap } from '@codemirror/commands'
import { sql } from '@codemirror/lang-sql'

const Host = styled.div`
  border: 1px solid ${({ theme }) => theme.color.border};
  border-radius: 6px;
  overflow: hidden;
  & .cm-editor {
    background: ${({ theme }) => theme.color.gridBg};
    color: ${({ theme }) => theme.color.text};
    font: ${({ theme }) => theme.font.mono};
    font-size: 13px;
  }
  & .cm-content {
    caret-color: ${({ theme }) => theme.color.accent};
  }
`

interface Props {
  value: string
  onChange: (value: string) => void
  onRun: () => void
}

export function SqlEditor({ value, onChange, onRun }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  // onRun/onChange를 최신으로 유지하는 ref (에디터를 재생성하지 않기 위해).
  const runRef = useRef(onRun)
  const changeRef = useRef(onChange)
  runRef.current = onRun
  changeRef.current = onChange

  useEffect(() => {
    if (hostRef.current === null) return
    const state = EditorState.create({
      doc: value,
      extensions: [
        keymap.of([
          {
            key: 'Mod-Enter',
            run: () => {
              runRef.current()
              return true
            },
          },
          ...defaultKeymap,
        ]),
        sql(),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) changeRef.current(u.state.doc.toString())
        }),
      ],
    })
    const view = new EditorView({ state, parent: hostRef.current })
    viewRef.current = view
    return () => {
      view.destroy()
      viewRef.current = null
    }
    // 마운트 시 한 번만 만든다. value 동기화는 아래 effect가 한다.
  }, [])

  // 외부 value가 에디터와 다르면 반영(초기화/프로그램적 설정 대응).
  useEffect(() => {
    const view = viewRef.current
    if (view === null) return
    const current = view.state.doc.toString()
    if (current !== value) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: value } })
    }
  }, [value])

  return <Host ref={hostRef} />
}
