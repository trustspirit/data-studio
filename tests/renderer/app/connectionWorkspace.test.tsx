// @vitest-environment jsdom
import { render, screen, fireEvent, within } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { ThemeProvider, darkTheme } from '@renderer/shared/theme'
import { ConnectionWorkspace } from '@renderer/app/ConnectionWorkspace'
import type { TabSet } from '@renderer/app/model/useDocumentTabs'
import type { OperationGateway, OperationOutcome } from '@renderer/gateways/ports/OperationGateway'
import type { AiAccountStatus } from '@renderer/gateways/ports/ConnectionGateway'
import type { Capability } from '@shared/types/capability'

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, value: 800 })
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: 400 })
  Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ width: 800, height: 400, top: 0, left: 0, right: 800, bottom: 400, x: 0, y: 0, toJSON() {} }),
  })
})

function gateway(): OperationGateway {
  return {
    run: vi.fn((req: { operation: { op?: string; table?: string } }): Promise<OperationOutcome> => {
      const op = req.operation.op
      if (op === 'listSchemas')
        return Promise.resolve({ ok: true, payload: { kind: 'schemas', schemas: [{ name: 'public' }] } })
      if (op === 'listTables')
        return Promise.resolve({
          ok: true,
          payload: {
            kind: 'tables',
            tables: [
              { schema: 'public', name: 'orders', kind: 'table', estimatedRows: null },
              { schema: 'public', name: 'users', kind: 'table', estimatedRows: null },
            ],
          },
        })
      if (op === 'describeTable')
        return Promise.resolve({
          ok: true,
          payload: {
            kind: 'tableDetail',
            detail: {
              schema: 'public',
              name: req.operation.table ?? '?',
              columns: [{ name: 'id', type: 'int8', nullable: false, defaultValue: null, primaryKeyOrdinal: 1 }],
            },
          },
        })
      if (op === 'listIndexes') return Promise.resolve({ ok: true, payload: { kind: 'indexes', indexes: [] } })
      if (op === 'listForeignKeys')
        return Promise.resolve({ ok: true, payload: { kind: 'foreignKeys', foreignKeys: [] } })
      return Promise.resolve({
        ok: true,
        payload: {
          kind: 'rows',
          rows: {
            requestId: 'r',
            columns: [{ name: 'id', type: '23' }],
            rows: [[{ t: 'int', v: 7 }]],
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

const ORDERS_TABS: TabSet = {
  documents: [{ kind: 'table', schema: 'public', table: 'orders' }],
  activeKey: 'table:public.orders',
}

interface WrapOptions {
  capabilities?: readonly Capability[]
  tabs?: TabSet
  aiAccount?: AiAccountStatus
  onOpenDocument?: () => void
  onCloseDocument?: (key: string) => void
  onActivateDocument?: (key: string) => void
  onNewQuery?: () => void
}

function wrap(options: WrapOptions = {}) {
  const {
    capabilities = ['sql', 'schema', 'data'] as Capability[],
    tabs = ORDERS_TABS,
    aiAccount,
    onOpenDocument = vi.fn(),
    onCloseDocument = vi.fn(),
    onActivateDocument = vi.fn(),
    onNewQuery = vi.fn(),
  } = options
  return render(
    <ThemeProvider theme={darkTheme}>
      <ConnectionWorkspace
        gateway={gateway()}
        connectionId="c1"
        connectionName="prod"
        capabilities={capabilities}
        engine="postgres"
        {...(aiAccount !== undefined ? { aiAccount } : {})}
        tabs={tabs}
        onOpenDocument={onOpenDocument}
        onCloseDocument={onCloseDocument}
        onActivateDocument={onActivateDocument}
        onNewQuery={onNewQuery}
      />
    </ThemeProvider>,
  )
}

describe('ConnectionWorkspace', () => {
  it('탭 줄과 활성 문서를 그린다', () => {
    render(
      <ThemeProvider theme={darkTheme}>
        <ConnectionWorkspace
          gateway={gateway()}
          connectionId="c1"
          connectionName="pg-dev"
          capabilities={['sql', 'schema', 'data'] as Capability[]}
          engine="postgres"
          tabs={{ documents: [{ kind: 'table', schema: 'public', table: 'orders' }], activeKey: 'table:public.orders' }}
          onOpenDocument={vi.fn()}
          onCloseDocument={vi.fn()}
          onActivateDocument={vi.fn()}
          onNewQuery={vi.fn()}
        />
      </ThemeProvider>,
    )
    expect(screen.getByTestId('doctab-table:public.orders')).toBeTruthy()
    expect(screen.getByTestId('docpane-table:public.orders')).toBeTruthy()
  })

  it('Redis 연결에서는 탭 줄을 감춘다', () => {
    render(
      <ThemeProvider theme={darkTheme}>
        <ConnectionWorkspace
          gateway={gateway()}
          connectionId="c1"
          connectionName="redis"
          capabilities={['keyvalue'] as Capability[]}
          tabs={{ documents: [{ kind: 'keys' }], activeKey: 'keys' }}
          onOpenDocument={vi.fn()}
          onCloseDocument={vi.fn()}
          onActivateDocument={vi.fn()}
          onNewQuery={vi.fn()}
        />
      </ThemeProvider>,
    )
    expect(screen.queryByRole('tablist')).toBeNull()
    expect(screen.getByTestId('docpane-keys')).toBeTruthy()
  })

  it('열 수 있는 종류가 여럿이면 탭 줄을 보인다 — 싱글턴 하나뿐일 때만 감춘다', () => {
    wrap({ capabilities: ['sql', 'schema', 'data'] })
    expect(screen.getByRole('tablist')).toBeTruthy()
  })

  it('탭을 누르면 그 문서 키로 onActivateDocument를 부른다', () => {
    const onActivateDocument = vi.fn()
    wrap({
      tabs: {
        documents: [
          { kind: 'table', schema: 'public', table: 'orders' },
          { kind: 'query', serial: 1 },
        ],
        activeKey: 'table:public.orders',
      },
      onActivateDocument,
    })
    fireEvent.click(screen.getByTestId('doctab-query:1'))
    expect(onActivateDocument).toHaveBeenCalledWith('query:1')
  })

  it('탭의 닫기가 그 문서 키로 onCloseDocument를 부른다', () => {
    const onCloseDocument = vi.fn()
    wrap({ onCloseDocument })
    fireEvent.click(screen.getByTestId('doctab-close-table:public.orders'))
    expect(onCloseDocument).toHaveBeenCalledWith('table:public.orders')
  })

  it('sql capability가 있으면 새 쿼리 버튼이 onNewQuery를 부른다', () => {
    const onNewQuery = vi.fn()
    wrap({ onNewQuery })
    fireEvent.click(screen.getByTestId('doctab-new-query'))
    expect(onNewQuery).toHaveBeenCalled()
  })

  it('sql capability가 없으면 새 쿼리 버튼이 아예 없다', () => {
    // 쿼리를 실행할 수 없는 엔진에서 ＋가 보이면 열리지 않는 탭을 권하는 셈이다.
    wrap({
      capabilities: ['schema', 'data'],
      tabs: { documents: [{ kind: 'er', schema: 'public' }], activeKey: 'er:public' },
    })
    expect(screen.queryByTestId('doctab-new-query')).toBeNull()
  })

  it('상태바가 연결 이름과 활성 문서 제목을 보여 준다', () => {
    wrap({
      tabs: {
        documents: [
          { kind: 'table', schema: 'public', table: 'orders' },
          { kind: 'query', serial: 2 },
        ],
        activeKey: 'query:2',
      },
    })
    // 제목은 탭 줄에도 있다 — 상태바 안에서 찾아야 상태바를 실제로 검사한다.
    const statusBar = screen.getByText('prod').parentElement as HTMLElement
    expect(within(statusBar).getByText('Query 2')).toBeTruthy()
  })

  it('열린 문서가 없으면 상태바에 문서 제목이 없다', () => {
    wrap({ tabs: { documents: [], activeKey: null } })
    expect(screen.getByTestId('document-empty')).toBeTruthy()
    expect(screen.getByText('prod')).toBeTruthy()
  })

  it('aiAccount=ready면 상태바에 전용 읽기 계정 배지가 뜬다', () => {
    wrap({ capabilities: ['sql'], tabs: { documents: [], activeKey: null }, aiAccount: 'ready' })
    expect(screen.getByTestId('ai-account-status').textContent).toContain('전용 읽기 계정')
  })

  it('aiAccount=failed면 사용자 계정 공유 폴백 경고가 뜬다', () => {
    wrap({ capabilities: ['sql'], tabs: { documents: [], activeKey: null }, aiAccount: 'failed' })
    expect(screen.getByTestId('ai-account-status').textContent).toContain('AI 계정 연결 실패')
  })

  it('aiAccount가 none이거나 없으면 배지가 없다', () => {
    const none = wrap({ capabilities: ['sql'], tabs: { documents: [], activeKey: null }, aiAccount: 'none' })
    expect(screen.queryByTestId('ai-account-status')).toBeNull()
    none.unmount()
    wrap({ capabilities: ['sql'], tabs: { documents: [], activeKey: null } }) // aiAccount 미전달
    expect(screen.queryByTestId('ai-account-status')).toBeNull()
  })

  it('상태바 오른쪽에 capability를 나열한다', () => {
    wrap({ capabilities: ['sql', 'schema', 'data'] })
    expect(screen.getByText('sql · schema · data')).toBeTruthy()
  })
})
