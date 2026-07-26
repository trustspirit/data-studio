// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { EditorView } from '@codemirror/view'
import { ThemeProvider, darkTheme } from '@renderer/shared/theme'
import { WorkspaceHost } from '@renderer/app/WorkspaceHost'
import type { OpenConnection } from '@renderer/app/model/useOpenConnections'
import type { TabSet } from '@renderer/app/model/useDocumentTabs'
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
/** 두 연결 모두 쿼리 문서 하나씩. 문서는 연결별로 따로 소유된다. */
const QUERY_TABS: Readonly<Record<string, TabSet>> = {
  a: { documents: [{ kind: 'query', serial: 1 }], activeKey: 'query:1' },
  b: { documents: [{ kind: 'query', serial: 1 }], activeKey: 'query:1' },
}

interface HostOverrides {
  tabs?: Readonly<Record<string, TabSet>>
  onOpenDocument?: (connectionId: string, doc: unknown) => void
  onCloseDocument?: (connectionId: string, key: string) => void
  onActivateDocument?: (connectionId: string, key: string) => void
  onNewQuery?: (connectionId: string) => void
}

function host(activeId: string, gw: OperationGateway, overrides: HostOverrides = {}) {
  const {
    tabs = QUERY_TABS,
    onOpenDocument = vi.fn(),
    onCloseDocument = vi.fn(),
    onActivateDocument = vi.fn(),
    onNewQuery = vi.fn(),
  } = overrides
  return (
    <ThemeProvider theme={darkTheme}>
      <WorkspaceHost
        connections={CONNECTIONS}
        open={OPEN}
        activeId={activeId}
        gateway={gw}
        tabs={tabs}
        onOpenDocument={onOpenDocument}
        onCloseDocument={onCloseDocument}
        onActivateDocument={onActivateDocument}
        onNewQuery={onNewQuery}
        onConnectionDirtyChange={vi.fn()}
      />
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
    expect(within(paneB).getByTestId('docpane-query:1')).toBeTruthy()
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

  it('탭 세트를 연결별로 나눠 준다 — 한쪽 문서가 다른 쪽에 새지 않는다', () => {
    render(
      host('a', gateway(), {
        tabs: {
          a: { documents: [{ kind: 'table', schema: 'public', table: 'users' }], activeKey: 'table:public.users' },
          b: { documents: [{ kind: 'query', serial: 3 }], activeKey: 'query:3' },
        },
      }),
    )
    expect(within(screen.getByTestId('workspace-a')).getByTestId('docpane-table:public.users')).toBeTruthy()
    expect(within(screen.getByTestId('workspace-a')).queryByTestId('docpane-query:3')).toBeNull()
    expect(within(screen.getByTestId('workspace-b')).getByTestId('docpane-query:3')).toBeTruthy()
  })

  it('탭 세트가 없는 연결은 빈 문서 상태로 뜬다', () => {
    render(host('a', gateway(), { tabs: {} }))
    expect(within(screen.getByTestId('workspace-a')).getByTestId('document-empty')).toBeTruthy()
  })

  it('문서 콜백에 그 판의 연결 id가 붙는다', () => {
    const onActivateDocument = vi.fn()
    const onCloseDocument = vi.fn()
    const onNewQuery = vi.fn()
    render(
      host('b', gateway(), {
        tabs: {
          b: {
            documents: [{ kind: 'query', serial: 1 }, { kind: 'query', serial: 2 }],
            activeKey: 'query:1',
          },
        },
        onActivateDocument,
        onCloseDocument,
        onNewQuery,
      }),
    )
    const paneB = screen.getByTestId('workspace-b')
    fireEvent.click(within(paneB).getByTestId('doctab-query:2'))
    expect(onActivateDocument).toHaveBeenCalledWith('b', 'query:2')
    fireEvent.click(within(paneB).getByTestId('doctab-close-query:1'))
    expect(onCloseDocument).toHaveBeenCalledWith('b', 'query:1')
    fireEvent.click(within(paneB).getByTestId('doctab-new-query'))
    expect(onNewQuery).toHaveBeenCalledWith('b')
  })

  // 모든 연결의 워크스페이스가 동시에 마운트돼 있다(숨김이지 언마운트가 아니다).
  // 탭 단축키는 window에 리스너를 단다 — 활성 여부로 끄지 않으면 숨은 연결의
  // 워크스페이스까지 같은 Cmd+W에 응답해, 사용자가 보고 있지도 않은 연결의
  // 탭이 함께 닫힌다. hidden 속성은 키보드 이벤트를 막아 주지 않는다.
  it('탭 단축키는 활성 연결의 워크스페이스에만 닿는다', () => {
    const onCloseDocument = vi.fn<(connectionId: string, key: string) => void>()
    render(host('a', gateway(), { onCloseDocument }))

    fireEvent.keyDown(window, { key: 'w', metaKey: true })

    expect(onCloseDocument).toHaveBeenCalledWith('a', 'query:1')
    expect(onCloseDocument).toHaveBeenCalledTimes(1)
    expect(onCloseDocument.mock.calls.map((c) => c[0])).not.toContain('b')
  })

  it('열리지 않은 연결은 판을 갖지 않는다', () => {
    render(
      <ThemeProvider theme={darkTheme}>
        <WorkspaceHost
          connections={CONNECTIONS}
          open={{ a: ready() }}
          activeId="a"
          gateway={gateway()}
          tabs={QUERY_TABS}
          onOpenDocument={vi.fn()}
          onCloseDocument={vi.fn()}
          onActivateDocument={vi.fn()}
          onNewQuery={vi.fn()}
          onConnectionDirtyChange={vi.fn()}
        />
      </ThemeProvider>,
    )
    expect(screen.getByTestId('workspace-a')).toBeTruthy()
    expect(screen.queryByTestId('workspace-b')).toBeNull()
  })
})
