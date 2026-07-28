import { useEffect, useMemo, useRef } from 'react'
import styled, { useTheme } from 'styled-components'
import { Compartment, EditorState, type Extension } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { defaultKeymap, historyKeymap, history } from '@codemirror/commands'
import { sql, type SQLNamespace } from '@codemirror/lang-sql'
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from '@codemirror/autocomplete'
import { syntaxHighlighting } from '@codemirror/language'
import type { EngineId } from '@shared/types/connection'
import { dialectFor, sqlHighlight } from '@renderer/entities/sql-lang'
import { SQL_SNIPPETS } from '../model/sqlLang'

const Host = styled.div`
  flex: 1;
  min-height: 0;
  border: 1px solid ${({ theme }) => theme.color.border.strong};
  border-radius: ${({ theme }) => theme.radius.md};
  overflow: hidden;
  & .cm-editor {
    height: 100%;
    background: ${({ theme }) => theme.color.surface.bg};
    color: ${({ theme }) => theme.color.text.primary};
    font-family: ${({ theme }) => theme.font.mono};
    font-size: ${({ theme }) => theme.fontSize.body};
  }
  & .cm-scroller {
    overflow: auto;
  }
  & .cm-content {
    caret-color: ${({ theme }) => theme.color.intent.accent};
  }
  & .cm-cursor {
    border-left-color: ${({ theme }) => theme.color.intent.accent};
  }
  & .cm-selectionBackground,
  & .cm-editor.cm-focused .cm-selectionBackground {
    background: rgba(10, 132, 255, 0.25);
  }
  /* 자동완성 툴팁 — 다크 테마에 맞춘다(CodeMirror 기본은 라이트). */
  & .cm-tooltip {
    background: ${({ theme }) => theme.color.surface.panel};
    border: 1px solid ${({ theme }) => theme.color.border.strong};
    border-radius: ${({ theme }) => theme.radius.md};
    color: ${({ theme }) => theme.color.text.primary};
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
    overflow: hidden;
  }
  & .cm-tooltip.cm-tooltip-autocomplete > ul {
    font-family: ${({ theme }) => theme.font.mono};
    font-size: ${({ theme }) => theme.fontSize.body};
    max-height: 220px;
  }
  & .cm-tooltip.cm-tooltip-autocomplete > ul > li {
    padding: 3px 8px;
    color: ${({ theme }) => theme.color.text.dim};
  }
  & .cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected] {
    background: ${({ theme }) => theme.color.intent.accent};
    color: ${({ theme }) => theme.color.intent.onAccent};
  }
  & .cm-completionMatchedText {
    text-decoration: none;
    color: ${({ theme }) => theme.color.intent.accent};
    font-weight: 600;
  }
  & li[aria-selected] .cm-completionMatchedText {
    color: ${({ theme }) => theme.color.intent.onAccent};
  }
  & .cm-completionDetail {
    color: ${({ theme }) => theme.color.text.faint};
    font-style: normal;
    margin-left: ${({ theme }) => theme.space.sm};
  }
  & li[aria-selected] .cm-completionDetail {
    color: rgba(255, 255, 255, 0.75);
  }
  & .cm-completionIcon {
    opacity: 0.6;
  }
  /* 스니펫 필드(탭으로 순회하는 자리) 표시 */
  & .cm-snippetField {
    background: rgba(10, 132, 255, 0.18);
    border-radius: 2px;
  }
`

/** 방언 + 스키마 자동완성 + 스니펫을 한 묶음으로 만든다(Compartment로 교체 가능). */
function langExtensions(
  engine: EngineId | undefined,
  namespace: SQLNamespace,
  defaultSchema: string | undefined,
): Extension {
  const dialect = dialectFor(engine)
  return [
    sql({
      dialect,
      schema: namespace,
      upperCaseKeywords: true,
      ...(defaultSchema !== undefined ? { defaultSchema } : {}),
    }),
    dialect.language.data.of({ autocomplete: SQL_SNIPPETS }),
  ]
}

interface Props {
  value: string
  onChange: (value: string) => void
  onRun: () => void
  /** SQL 방언 선택용. 미지정이면 표준 SQL 키워드로 폴백. */
  engine?: EngineId | undefined
  /** 스키마/테이블 자동완성 네임스페이스. */
  namespace?: SQLNamespace | undefined
  /** 접두어 없는 테이블 완성에 쓸 기본 스키마. */
  defaultSchema?: string | undefined
}

export function SqlEditor({ value, onChange, onRun, engine, namespace, defaultSchema }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const theme = useTheme()
  const highlight = useMemo(() => syntaxHighlighting(sqlHighlight(theme)), [theme])
  // onRun/onChange를 최신으로 유지하는 ref (에디터를 재생성하지 않기 위해).
  const runRef = useRef(onRun)
  const changeRef = useRef(onChange)
  runRef.current = onRun
  changeRef.current = onChange
  // 언어 번들은 Compartment로 관리 — 스키마 정보가 늦게 도착해도 에디터를
  // 재생성하지 않고 reconfigure로 갈아끼운다.
  const langCompartment = useRef(new Compartment())
  const langRef = useRef({ engine, namespace: namespace ?? {}, defaultSchema })
  langRef.current = { engine, namespace: namespace ?? {}, defaultSchema }

  useEffect(() => {
    if (hostRef.current === null) return
    const initial = langRef.current
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
          ...closeBracketsKeymap,
          ...completionKeymap,
          ...historyKeymap,
          ...defaultKeymap,
        ]),
        history(),
        langCompartment.current.of(
          langExtensions(initial.engine, initial.namespace, initial.defaultSchema),
        ),
        highlight,
        autocompletion({ activateOnTyping: true }),
        closeBrackets(),
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
    // 마운트 시 한 번만 만든다. value/언어 동기화는 아래 effect가 한다.
  }, [])

  // 방언/스키마 정보가 바뀌면 언어 번들만 교체한다.
  useEffect(() => {
    const view = viewRef.current
    if (view === null) return
    view.dispatch({
      effects: langCompartment.current.reconfigure(
        langExtensions(engine, namespace ?? {}, defaultSchema),
      ),
    })
  }, [engine, namespace, defaultSchema])

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
