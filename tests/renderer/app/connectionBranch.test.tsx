// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { ThemeProvider, darkTheme } from '@renderer/shared/theme'
import { GatewayProvider } from '@renderer/app/GatewayProvider'
import { buildGateways } from '@renderer/app/container'
import { AppShell } from '@renderer/app/AppShell'
import type { DataconBridge } from '@renderer/gateways/ipc/ipcInvoke'

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ width: 800, height: 400, top: 0, left: 0, right: 800, bottom: 400, x: 0, y: 0, toJSON() {} }),
  })
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, value: 800 })
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: 400 })
})

function conn(id: string, name: string) {
  return { id, name, engine: 'postgres', host: 'h', port: 5432, database: 'd', username: 'u', tlsMode: 'disable', aiReadOnlyUsername: null, maskedColumnPatterns: [] }
}

/** 연결마다 스키마 이름이 다른 브리지 — 어느 가지의 데이터인지 구분된다. */
function bridge(list: ReturnType<typeof conn>[]): DataconBridge {
  const schemasOf: Record<string, string> = { a: 'schema_a', b: 'schema_b' }
  return {
    invoke: vi.fn((channel: string, input: unknown): Promise<unknown> => {
      if (channel === 'connection:list') return Promise.resolve({ ok: true, value: list })
      if (channel === 'secrets:status') return Promise.resolve({ ok: true, value: { persistent: true } })
      if (channel === 'secrets:has') return Promise.resolve({ ok: true, value: { exists: false } })
      if (channel === 'connection:open')
        return Promise.resolve({ ok: true, value: { opened: true, capabilities: ['sql', 'schema', 'data'] } })
      if (channel === 'connection:close') return Promise.resolve({ ok: true, value: null })
      if (channel === 'operation:run') {
        const req = input as { connectionId: string; operation: { op?: string; schema?: string } }
        const schema = schemasOf[req.connectionId] ?? 'public'
        if (req.operation.op === 'listSchemas')
          return Promise.resolve({ ok: true, value: { ok: true, payload: { kind: 'schemas', schemas: [{ name: schema }] } } })
        if (req.operation.op === 'listTables')
          return Promise.resolve({
            ok: true,
            value: {
              ok: true,
              payload: {
                kind: 'tables',
                tables: [{ schema: req.operation.schema ?? schema, name: `table_${req.connectionId}`, kind: 'table', estimatedRows: null }],
              },
            },
          })
        return Promise.resolve({
          ok: true,
          value: {
            ok: true,
            payload: {
              kind: 'rows',
              rows: {
                requestId: 'r', columns: [{ name: 'id', type: '23' }], rows: [[{ t: 'int', v: 7 }]],
                page: { cursor: null, hasMore: false, rowCount: 1, bytes: 10 },
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
function tree(): HTMLElement {
  return screen.getByTestId('connection-tree')
}

async function openBoth(b: DataconBridge): Promise<void> {
  wrap(b)
  await waitFor(() => expect(screen.getByTestId('connect-a')).toBeTruthy())
  fireEvent.click(screen.getByTestId('connect-a'))
  await waitFor(() => expect(screen.getByTestId('workspace-a')).toBeTruthy())
  fireEvent.click(screen.getByTestId('connect-b'))
  await waitFor(() => expect(screen.getByTestId('workspace-b')).toBeTruthy())
}

describe('ConnectionBranch', () => {
  it('열린 연결 아래에 그 연결의 스키마가 인라인으로 붙는다', async () => {
    wrap(bridge([conn('a', 'prod')]))
    await waitFor(() => expect(screen.getByTestId('connect-a')).toBeTruthy())
    fireEvent.click(screen.getByTestId('connect-a'))
    // 열면 자동으로 펼쳐진다.
    await waitFor(() => expect(within(tree()).getByText(/schema_a/)).toBeTruthy())
  })

  it('접으면 가지가 사라지고 다시 펼치면 돌아온다', async () => {
    wrap(bridge([conn('a', 'prod')]))
    await waitFor(() => expect(screen.getByTestId('connect-a')).toBeTruthy())
    fireEvent.click(screen.getByTestId('connect-a'))
    await waitFor(() => expect(within(tree()).getByText(/schema_a/)).toBeTruthy())

    fireEvent.click(screen.getByTestId('chevron-a'))
    await waitFor(() => expect(within(tree()).queryByText(/schema_a/)).toBeNull())
    // 접기는 시각적일 뿐이다 — 연결은 그대로 열려 있다.
    expect(screen.getByTestId('close-a')).toBeTruthy()

    fireEvent.click(screen.getByTestId('chevron-a'))
    await waitFor(() => expect(within(tree()).getByText(/schema_a/)).toBeTruthy())
  })

  it('두 연결의 가지가 서로 독립이다', async () => {
    await openBoth(bridge([conn('a', 'prod'), conn('b', 'staging')]))
    await waitFor(() => expect(within(tree()).getByText(/schema_a/)).toBeTruthy())
    await waitFor(() => expect(within(tree()).getByText(/schema_b/)).toBeTruthy())

    // A의 스키마만 펼친다 — B의 테이블이 딸려 나오면 안 된다.
    fireEvent.click(within(tree()).getByText(/schema_a/))
    await waitFor(() => expect(within(tree()).getByText('table_a')).toBeTruthy())
    expect(within(tree()).queryByText('table_b')).toBeNull()

    fireEvent.click(within(tree()).getByText(/schema_b/))
    await waitFor(() => expect(within(tree()).getByText('table_b')).toBeTruthy())
    // A의 확장은 그대로 남아 있다.
    expect(within(tree()).getByText('table_a')).toBeTruthy()
  })

  it('테이블 클릭이 그 연결만 선택하고 활성으로 만든다', async () => {
    await openBoth(bridge([conn('a', 'prod'), conn('b', 'staging')]))
    await waitFor(() => expect(within(tree()).getByText(/schema_a/)).toBeTruthy())
    fireEvent.click(within(tree()).getByText(/schema_a/))
    await waitFor(() => expect(within(tree()).getByText('table_a')).toBeTruthy())

    // B가 활성인 상태에서 A의 테이블을 고르면 A로 옮겨 간다.
    expect(screen.getByTestId('workspace-b').hasAttribute('hidden')).toBe(false)
    fireEvent.click(within(tree()).getByText('table_a'))
    await waitFor(() => expect(screen.getByTestId('workspace-a').hasAttribute('hidden')).toBe(false))
    expect(screen.getByTestId('workspace-b').hasAttribute('hidden')).toBe(true)
  })

  it('연결을 닫으면 그 가지도 사라진다', async () => {
    await openBoth(bridge([conn('a', 'prod'), conn('b', 'staging')]))
    await waitFor(() => expect(within(tree()).getByText(/schema_a/)).toBeTruthy())
    fireEvent.click(screen.getByTestId('close-a'))
    await waitFor(() => expect(within(tree()).queryByText(/schema_a/)).toBeNull())
    expect(within(tree()).getByText(/schema_b/)).toBeTruthy()
  })
})
