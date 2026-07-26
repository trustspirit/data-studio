// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { ThemeProvider, darkTheme } from '@renderer/shared/theme'
import { DocumentHost } from '@renderer/app/DocumentHost'
import { documentKey, type Document } from '@renderer/entities/document'
import type { OperationGateway, OperationOutcome } from '@renderer/gateways/ports/OperationGateway'

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ width: 800, height: 400, top: 0, left: 0, right: 800, bottom: 400, x: 0, y: 0, toJSON() {} }),
  })
})

function gateway(): OperationGateway {
  return {
    run: vi.fn(() =>
      Promise.resolve({
        ok: true,
        payload: {
          kind: 'rows',
          rows: {
            requestId: 'r',
            columns: [{ name: 'id', type: '23' }],
            rows: [[{ t: 'int', v: 1 }]],
            page: { cursor: null, hasMore: false, rowCount: 1, bytes: 8 },
            meta: { durationMs: 1, truncatedRows: false, truncatedBytes: false, rowsAffected: null },
          },
        },
      }),
    ),
    cancel: vi.fn(() => Promise.resolve()),
  } as unknown as OperationGateway
}

const ORDERS: Document = { kind: 'table', schema: 'public', table: 'orders' }
const QUERY: Document = { kind: 'query', serial: 1 }

function renderHost(documents: readonly Document[], activeKey: string | null) {
  return render(
    <ThemeProvider theme={darkTheme}>
      <DocumentHost
        documents={documents}
        activeKey={activeKey}
        gateway={gateway()}
        connectionId="c1"
        engine="postgres"
        schemas={['public']}
        onOpenDocument={vi.fn()}
      />
    </ThemeProvider>,
  )
}

describe('DocumentHost', () => {
  it('열린 문서를 전부 마운트한다', () => {
    renderHost([ORDERS, QUERY], documentKey(ORDERS))
    expect(screen.getByTestId(`docpane-${documentKey(ORDERS)}`)).toBeTruthy()
    expect(screen.getByTestId(`docpane-${documentKey(QUERY)}`)).toBeTruthy()
  })

  it('비활성 문서는 hidden으로 숨긴다 — 언마운트하면 작성 중인 SQL이 사라진다', () => {
    renderHost([ORDERS, QUERY], documentKey(ORDERS))
    expect(screen.getByTestId(`docpane-${documentKey(QUERY)}`).hasAttribute('hidden')).toBe(true)
    expect(screen.getByTestId(`docpane-${documentKey(ORDERS)}`).hasAttribute('hidden')).toBe(false)
    // hidden만으로는 접근성 트리에서 사라지지 않는다 — aria-hidden도 함께 줘야 한다.
    expect(screen.getByTestId(`docpane-${documentKey(QUERY)}`).getAttribute('aria-hidden')).toBe('true')
    expect(screen.getByTestId(`docpane-${documentKey(ORDERS)}`).getAttribute('aria-hidden')).toBe('false')
  })

  it('테이블 문서에는 인스펙터가 붙는다', () => {
    renderHost([ORDERS], documentKey(ORDERS))
    expect(screen.getByTestId('inspector-section-columns')).toBeTruthy()
  })

  it('테이블 문서 툴바에 DDL 액션이 있다', () => {
    renderHost([ORDERS], documentKey(ORDERS))
    expect(screen.getByTestId('ddl-open-add-column')).toBeTruthy()
    expect(screen.getByTestId('ddl-open-drop-table')).toBeTruthy()
  })

  it('열린 문서가 없으면 안내를 보여 준다', () => {
    renderHost([], null)
    expect(screen.getByTestId('document-empty')).toBeTruthy()
  })

  it('Host는 position: relative다 — 없으면 DDL 오버레이의 배경/시트가 컨테이너 밖으로 새어 나간다', () => {
    renderHost([ORDERS], documentKey(ORDERS))
    // Pane은 Host의 직계 자식이다 — Host 자체엔 testid가 없어 그 부모로 찾는다.
    const host = screen.getByTestId(`docpane-${documentKey(ORDERS)}`).parentElement as HTMLElement
    expect(getComputedStyle(host).position).toBe('relative')
  })

  it('활성 문서가 바뀌면 열려 있던 DDL 폼이 닫힌다', () => {
    const { rerender } = renderHost([ORDERS, QUERY], documentKey(ORDERS))
    fireEvent.click(screen.getByTestId('ddl-open-add-column'))
    expect(screen.getByTestId('designer-overlay')).toBeTruthy()

    // 다른 문서로 활성을 옮긴다 — key로 폼을 다시 마운트해도 target은 호스트
    // 상태라 그대로 살아남으므로, 그것만으로는 안전해지지 않는다는 게 이
    // 리뷰의 지적이었다. 실제 방어는 activeKey 변화에 designer를 닫는 effect다.
    rerender(
      <ThemeProvider theme={darkTheme}>
        <DocumentHost
          documents={[ORDERS, QUERY]}
          activeKey={documentKey(QUERY)}
          gateway={gateway()}
          connectionId="c1"
          engine="postgres"
          schemas={['public']}
          onOpenDocument={vi.fn()}
        />
      </ThemeProvider>,
    )
    expect(screen.queryByTestId('designer-overlay')).toBeNull()
  })

  it(
    '여러 테이블 문서가 열려 있어도 DDL 폼은 활성 문서의 컬럼만 보여준다 — ' +
      '비활성 문서의 응답이 늦게 와도 활성 문서의 구조를 덮어쓰지 않는다',
    async () => {
      const ORDERS2: Document = { kind: 'table', schema: 'public', table: 'orders' }
      const USERS2: Document = { kind: 'table', schema: 'public', table: 'users' }

      // USERS(비활성 문서)의 describeTable 응답을 손으로 쥐고 있다가 나중에 흘려보낸다.
      // 공유 슬롯이었다면 이 응답이 활성 문서(ORDERS)의 컬럼을 덮어썼을 것이다.
      const usersResolver: { resolve: ((out: OperationOutcome) => void) | null } = { resolve: null }
      const run = vi.fn((req: { operation: { op: string; table?: string } }): Promise<OperationOutcome> => {
        const { op, table } = req.operation
        if (op === 'describeTable' && table === 'users') {
          return new Promise<OperationOutcome>((resolve) => {
            usersResolver.resolve = resolve
          })
        }
        if (op === 'describeTable' && table === 'orders') {
          return Promise.resolve({
            ok: true,
            payload: {
              kind: 'tableDetail',
              detail: {
                schema: 'public',
                name: 'orders',
                columns: [
                  { name: 'order_id', type: 'int8', nullable: false, defaultValue: null, primaryKeyOrdinal: 1 },
                  { name: 'total', type: 'numeric', nullable: false, defaultValue: null, primaryKeyOrdinal: null },
                ],
              },
            },
          })
        }
        if (op === 'listIndexes') return Promise.resolve({ ok: true, payload: { kind: 'indexes', indexes: [] } })
        if (op === 'listForeignKeys')
          return Promise.resolve({ ok: true, payload: { kind: 'foreignKeys', foreignKeys: [] } })
        return Promise.resolve({
          ok: true,
          payload: {
            kind: 'rows',
            rows: {
              requestId: 'r',
              columns: [],
              rows: [],
              page: { cursor: null, hasMore: false, rowCount: 0, bytes: 0 },
              meta: { durationMs: 1, truncatedRows: false, truncatedBytes: false, rowsAffected: null },
            },
          },
        })
      })
      const g = { run, cancel: vi.fn(() => Promise.resolve()) } as unknown as OperationGateway

      render(
        <ThemeProvider theme={darkTheme}>
          <DocumentHost
            documents={[ORDERS2, USERS2]}
            activeKey={documentKey(ORDERS2)}
            gateway={g}
            connectionId="c1"
            engine="postgres"
            schemas={['public']}
            onOpenDocument={vi.fn()}
          />
        </ThemeProvider>,
      )

      // 활성 문서(orders)의 구조가 먼저 뜬다.
      await waitFor(() => expect(screen.getByText('order_id')).toBeTruthy())

      // 이제서야 비활성 문서(users)의 응답을 흘려보낸다 — 활성 문서보다 늦게 도착한다.
      usersResolver.resolve?.({
        ok: true,
        payload: {
          kind: 'tableDetail',
          detail: {
            schema: 'public',
            name: 'users',
            columns: [
              { name: 'user_id', type: 'int8', nullable: false, defaultValue: null, primaryKeyOrdinal: 1 },
              { name: 'email', type: 'text', nullable: false, defaultValue: null, primaryKeyOrdinal: null },
            ],
          },
        },
      })
      await waitFor(() => expect(run.mock.calls.some((c) => c[0].operation.table === 'users')).toBe(true))
      // users의 응답이 처리될 시간을 준다.
      await new Promise((resolve) => setTimeout(resolve, 0))

      // 활성 문서(orders)의 컬럼 옆 Drop 버튼으로 DDL 폼을 연다.
      fireEvent.click(screen.getByTestId('col-drop-order_id'))

      const select = screen.getByTestId('ddl-target-column') as HTMLSelectElement
      const options = Array.from(select.options).map((o) => o.value)
      expect(options).toContain('order_id')
      expect(options).toContain('total')
      expect(options).not.toContain('user_id')
      expect(options).not.toContain('email')
    },
  )
})
