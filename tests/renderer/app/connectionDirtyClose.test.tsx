// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { ThemeProvider, darkTheme } from '@renderer/shared/theme'
import { GatewayProvider } from '@renderer/app/GatewayProvider'
import { buildGateways } from '@renderer/app/container'
import { AppShell } from '@renderer/app/AppShell'
import type { DataconBridge } from '@renderer/gateways/ipc/ipcInvoke'

// 스펙 원문: "미적용 편집이 있는 table 탭을 닫으면 확인을 받는다. 연결 닫기도
// 같은 검사를 통과한다." 이 파일은 그 두 번째 문장 — 연결 자체를 닫거나
// 삭제하는 경로도 dirty 문서가 있으면 확인 없이 조용히 편집을 버려서는 안
// 된다는 것 — 을 검증한다.

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ width: 800, height: 400, top: 0, left: 0, right: 800, bottom: 400, x: 0, y: 0, toJSON() {} }),
  })
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, value: 800 })
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: 400 })
})

function conn(id: string, name: string) {
  return {
    id,
    name,
    engine: 'postgres',
    host: 'h',
    port: 5432,
    database: 'd',
    username: 'u',
    tlsMode: 'disable',
    aiReadOnlyUsername: null,
    maskedColumnPatterns: [],
  }
}

/** PK가 있는 테이블 하나(orders)를 스키마 트리와 데이터 뷰 양쪽에 일관되게 내주는 브리지. */
function bridge(list: ReturnType<typeof conn>[] = [conn('a', 'prod')]): DataconBridge {
  const store = [...list]
  return {
    invoke: vi.fn((channel: string, input: unknown): Promise<unknown> => {
      if (channel === 'connection:list') return Promise.resolve({ ok: true, value: store })
      if (channel === 'connection:delete') return Promise.resolve({ ok: true, value: null })
      if (channel === 'connection:close') return Promise.resolve({ ok: true, value: null })
      if (channel === 'connection:open')
        return Promise.resolve({ ok: true, value: { opened: true, capabilities: ['sql', 'schema', 'data'] } })
      if (channel === 'secrets:status') return Promise.resolve({ ok: true, value: { persistent: true } })
      if (channel === 'secrets:has') return Promise.resolve({ ok: true, value: { exists: false } })
      if (channel === 'operation:run') {
        const req = input as { operation: { op?: string; schema?: string } }
        const op = req.operation.op
        if (op === 'listSchemas')
          return Promise.resolve({ ok: true, value: { ok: true, payload: { kind: 'schemas', schemas: [{ name: 'public' }] } } })
        if (op === 'listTables')
          return Promise.resolve({
            ok: true,
            value: {
              ok: true,
              payload: { kind: 'tables', tables: [{ schema: 'public', name: 'orders', kind: 'table', estimatedRows: null }] },
            },
          })
        if (op === 'describeTable')
          return Promise.resolve({
            ok: true,
            value: {
              ok: true,
              payload: {
                kind: 'tableDetail',
                detail: {
                  schema: 'public',
                  name: 'orders',
                  columns: [{ name: 'id', type: 'int8', nullable: false, defaultValue: null, primaryKeyOrdinal: 1 }],
                },
              },
            },
          })
        if (op === 'listIndexes')
          return Promise.resolve({ ok: true, value: { ok: true, payload: { kind: 'indexes', indexes: [] } } })
        if (op === 'listForeignKeys')
          return Promise.resolve({ ok: true, value: { ok: true, payload: { kind: 'foreignKeys', foreignKeys: [] } } })
        return Promise.resolve({
          ok: true,
          value: {
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
          },
        })
      }
      return Promise.resolve({ ok: true, value: null })
    }),
    on: () => () => {},
  }
}

function wrap(b: DataconBridge) {
  return render(
    <ThemeProvider theme={darkTheme}>
      <GatewayProvider gateways={buildGateways(b)}>
        <AppShell />
      </GatewayProvider>
    </ThemeProvider>,
  )
}
function channelsOf(bridgeInst: DataconBridge): string[] {
  // eslint-disable-next-line @typescript-eslint/unbound-method -- vi.fn mock, no `this` binding involved
  return vi.mocked(bridgeInst.invoke).mock.calls.map((c) => c[0])
}
function tree(): HTMLElement {
  return screen.getByTestId('connection-tree')
}

/** 연결 a에 접속하고, orders 테이블을 열어 행 추가로 dirty를 만든다. */
async function openDirtyTable(b: DataconBridge): Promise<void> {
  wrap(b)
  await waitFor(() => expect(screen.getByTestId('connect-a')).toBeTruthy())
  fireEvent.click(screen.getByTestId('connect-a'))
  await waitFor(() => expect(screen.getByTestId('workspace-a')).toBeTruthy())

  await waitFor(() => expect(within(tree()).getByText(/public/)).toBeTruthy())
  fireEvent.click(within(tree()).getByText(/public/))
  await waitFor(() => expect(within(tree()).getByText('orders')).toBeTruthy())
  fireEvent.doubleClick(within(tree()).getByText('orders'))
  await waitFor(() => expect(screen.getByTestId('doctab-table:public.orders')).toBeTruthy())

  await waitFor(() => expect(within(screen.getByTestId('workspace-a')).getByText('Add row')).toBeTruthy())
  fireEvent.click(within(screen.getByTestId('workspace-a')).getByText('Add row'))
}

describe('연결 닫기/삭제도 dirty 문서를 확인 없이 버리지 않는다', () => {
  it('dirty 문서가 없으면 연결 닫기는 확인 없이 바로 처리된다', async () => {
    const b = bridge()
    wrap(b)
    await waitFor(() => expect(screen.getByTestId('connect-a')).toBeTruthy())
    fireEvent.click(screen.getByTestId('connect-a'))
    await waitFor(() => expect(screen.getByTestId('workspace-a')).toBeTruthy())

    fireEvent.click(screen.getByTestId('more-a'))
    fireEvent.click(screen.getByTestId('close-a'))

    await waitFor(() => expect(channelsOf(b)).toContain('connection:close'))
    expect(screen.queryByTestId('confirm-close-connection')).toBeNull()
  })

  it('dirty 문서가 있는 연결을 닫으려 하면 확인부터 받는다', async () => {
    const b = bridge()
    await openDirtyTable(b)

    fireEvent.click(screen.getByTestId('more-a'))
    fireEvent.click(screen.getByTestId('close-a'))

    expect(channelsOf(b)).not.toContain('connection:close')
    expect(screen.getByTestId('confirm-close-connection')).toBeTruthy()

    fireEvent.click(screen.getByTestId('confirm-close-connection-ok'))
    await waitFor(() => expect(channelsOf(b)).toContain('connection:close'))
    await waitFor(() => expect(screen.queryByTestId('workspace-a')).toBeNull())
  })

  it('연결 닫기 확인에서 취소하면 연결이 그대로 열려 있다', async () => {
    const b = bridge()
    await openDirtyTable(b)

    fireEvent.click(screen.getByTestId('more-a'))
    fireEvent.click(screen.getByTestId('close-a'))
    expect(screen.getByTestId('confirm-close-connection')).toBeTruthy()

    fireEvent.click(screen.getByTestId('confirm-close-connection-cancel'))

    expect(channelsOf(b)).not.toContain('connection:close')
    expect(screen.queryByTestId('confirm-close-connection')).toBeNull()
    expect(screen.getByTestId('workspace-a')).toBeTruthy()
  })

  it('dirty 문서가 있는 연결을 삭제하려 해도(삭제는 닫기부터 하므로) 확인부터 받는다', async () => {
    const b = bridge()
    await openDirtyTable(b)

    fireEvent.click(screen.getByTestId('more-a'))
    fireEvent.click(screen.getByTestId('settings-a'))
    await waitFor(() => expect(screen.getByText('Delete')).toBeTruthy())
    fireEvent.click(screen.getByText('Delete'))
    fireEvent.click(screen.getByText(/Confirm delete/i))

    // 폼 자체의 2단계 확인(Delete → Confirm delete)은 통과했지만, 이 연결에
    // dirty 문서가 있으므로 실제 close/delete는 아직 나가면 안 된다.
    expect(channelsOf(b)).not.toContain('connection:close')
    expect(channelsOf(b)).not.toContain('connection:delete')
    expect(screen.getByTestId('confirm-close-connection')).toBeTruthy()

    fireEvent.click(screen.getByTestId('confirm-close-connection-ok'))
    await waitFor(() => expect(channelsOf(b)).toContain('connection:delete'))
    const order = channelsOf(b)
    expect(order.indexOf('connection:close')).toBeGreaterThanOrEqual(0)
    expect(order.indexOf('connection:close')).toBeLessThan(order.indexOf('connection:delete'))
  })
})
