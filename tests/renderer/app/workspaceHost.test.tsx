// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { EditorView } from '@codemirror/view'
import { ThemeProvider, darkTheme } from '@renderer/shared/theme'
import { WorkspaceHost } from '@renderer/app/WorkspaceHost'
import type { OpenConnection } from '@renderer/app/model/useOpenConnections'
import type { ConnectionConfig } from '@shared/types/connection'
import type { OperationGateway, OperationOutcome } from '@renderer/gateways/ports/OperationGateway'

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, value: 800 })
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: 400 })
  Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ width: 800, height: 400, top: 0, left: 0, right: 800, bottom: 400, x: 0, y: 0, toJSON() {} }),
  })
})

function conn(id: string, name: string): ConnectionConfig {
  return {
    id, name, engine: 'postgres', host: 'h', port: 5432, database: 'd',
    username: 'u', tlsMode: 'disable', aiReadOnlyUsername: null, maskedColumnPatterns: [],
  }
}
function ready(): OpenConnection {
  return { state: 'ready', capabilities: ['sql', 'schema', 'data'], aiAccount: 'none', error: null }
}
function gateway(): OperationGateway {
  return {
    run: vi.fn((req: { operation: { op?: string } }): Promise<OperationOutcome> => {
      const op = req.operation.op
      if (op === 'listSchemas')
        return Promise.resolve({ ok: true, payload: { kind: 'schemas', schemas: [{ name: 'public' }] } })
      if (op === 'listTables')
        return Promise.resolve({
          ok: true,
          payload: { kind: 'tables', tables: [{ schema: 'public', name: 'users', kind: 'table', estimatedRows: null }] },
        })
      return Promise.resolve({
        ok: true,
        payload: {
          kind: 'rows',
          rows: {
            requestId: 'r', columns: [{ name: 'id', type: '23' }], rows: [[{ t: 'int', v: 7 }]],
            page: { cursor: null, hasMore: false, rowCount: 1, bytes: 10 },
            meta: { durationMs: 1, truncatedRows: false, truncatedBytes: false, rowsAffected: null },
          },
        },
      })
    }) as OperationGateway['run'],
    cancel: vi.fn().mockResolvedValue(undefined),
    recentAudit: vi.fn().mockResolvedValue([]),
    onStreamMessage: vi.fn(() => () => {}),
  }
}

const CONNECTIONS = [conn('a', 'prod'), conn('b', 'staging')]
const OPEN = { a: ready(), b: ready() }

function host(activeId: string, gw: OperationGateway) {
  return (
    <ThemeProvider theme={darkTheme}>
      <WorkspaceHost connections={CONNECTIONS} open={OPEN} activeId={activeId} gateway={gw} />
    </ThemeProvider>
  )
}

/** 판(pane) 안의 CodeMirror 문서 본문. */
function sqlTextIn(pane: HTMLElement): string {
  const view = EditorView.findFromDOM(pane)
  if (view === null) throw new Error('편집기를 찾지 못했다')
  return view.state.doc.toString()
}
function typeSqlIn(pane: HTMLElement, text: string): void {
  const view = EditorView.findFromDOM(pane)
  if (view === null) throw new Error('편집기를 찾지 못했다')
  act(() => {
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } })
  })
}

describe('WorkspaceHost', () => {
  it('열린 연결마다 워크스페이스를 마운트하고 활성인 것만 보여 준다', () => {
    render(host('a', gateway()))
    const paneA = screen.getByTestId('workspace-a')
    const paneB = screen.getByTestId('workspace-b')
    expect(paneA.hasAttribute('hidden')).toBe(false)
    expect(paneB.hasAttribute('hidden')).toBe(true)
    expect(paneB.getAttribute('aria-hidden')).toBe('true')
    // 두 워크스페이스가 실제로 마운트돼 있다(숨김이지 언마운트가 아니다).
    expect(within(paneB).getByTestId('subtab-query')).toBeTruthy()
  })

  it('숨은 워크스페이스는 접근성 트리에서 빠진다', () => {
    render(host('a', gateway()))
    // role 조회는 aria-hidden을 존중한다 — 활성 판의 Run 버튼 하나만 잡혀야 한다.
    expect(screen.getAllByRole('button', { name: 'Run' })).toHaveLength(1)
  })

  it('작성 중인 SQL이 연결 전환에도 살아남고 다른 연결로 새지 않는다', async () => {
    const gw = gateway()
    const { rerender } = render(host('a', gw))

    typeSqlIn(screen.getByTestId('workspace-a'), 'SELECT 1 FROM only_in_a')
    expect(sqlTextIn(screen.getByTestId('workspace-a'))).toBe('SELECT 1 FROM only_in_a')
    // B의 편집기는 A의 텍스트를 본 적이 없어야 한다.
    expect(sqlTextIn(screen.getByTestId('workspace-b'))).toBe('')

    rerender(host('b', gw))
    expect(screen.getByTestId('workspace-b').hasAttribute('hidden')).toBe(false)
    expect(sqlTextIn(screen.getByTestId('workspace-b'))).toBe('')
    typeSqlIn(screen.getByTestId('workspace-b'), 'SELECT 2 FROM only_in_b')

    rerender(host('a', gw))
    // A로 돌아오면 A가 쓰던 것이 그대로 있어야 한다 — 전환이 초안을 지우면 안 된다.
    expect(sqlTextIn(screen.getByTestId('workspace-a'))).toBe('SELECT 1 FROM only_in_a')
    expect(sqlTextIn(screen.getByTestId('workspace-b'))).toBe('SELECT 2 FROM only_in_b')
    await waitFor(() => expect(screen.getByTestId('workspace-b').hasAttribute('hidden')).toBe(true))
  })

  it('서브탭 선택이 연결별로 따로 유지된다', async () => {
    const gw = gateway()
    const { rerender } = render(host('a', gw))

    fireEvent.click(within(screen.getByTestId('workspace-a')).getByTestId('subtab-structure'))
    await waitFor(() => expect(within(screen.getByTestId('workspace-a')).getByText(/public/)).toBeTruthy())

    rerender(host('b', gw))
    // B는 A의 서브탭 선택을 물려받지 않는다 — 기본값 Query여야 한다.
    expect(within(screen.getByTestId('workspace-b')).getByText(/Query — staging/)).toBeTruthy()

    rerender(host('a', gw))
    // A는 Structure에 그대로 있다.
    expect(within(screen.getByTestId('workspace-a')).queryByText(/Query — prod/)).toBeNull()
    expect(within(screen.getByTestId('workspace-a')).getByText(/public/)).toBeTruthy()
  })

  it('열리지 않은 연결은 판을 갖지 않는다', () => {
    render(
      <ThemeProvider theme={darkTheme}>
        <WorkspaceHost connections={CONNECTIONS} open={{ a: ready() }} activeId="a" gateway={gateway()} />
      </ThemeProvider>,
    )
    expect(screen.getByTestId('workspace-a')).toBeTruthy()
    expect(screen.queryByTestId('workspace-b')).toBeNull()
  })
})
