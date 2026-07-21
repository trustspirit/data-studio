// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { ThemeProvider, darkTheme } from '@renderer/shared/theme'
import { ErView } from '@renderer/features/er'
import type { OperationGateway, OperationOutcome } from '@renderer/gateways/ports/OperationGateway'

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ width: 800, height: 400, top: 0, left: 0, right: 800, bottom: 400, x: 0, y: 0, toJSON() {} }),
  })
})

function outcome(op: string, table?: string): OperationOutcome {
  switch (op) {
    case 'listSchemas':
      return { ok: true, payload: { kind: 'schemas', schemas: [{ name: 'public' }] } }
    case 'listTables':
      return {
        ok: true,
        payload: {
          kind: 'tables',
          tables: [
            { schema: 'public', name: 'orders', kind: 'table', estimatedRows: null },
            { schema: 'public', name: 'users', kind: 'table', estimatedRows: null },
          ],
        },
      }
    case 'describeTable':
      return {
        ok: true,
        payload: {
          kind: 'tableDetail',
          detail: {
            schema: 'public',
            name: table ?? '?',
            columns: [{ name: 'id', type: 'int8', nullable: false, defaultValue: null, primaryKeyOrdinal: 1 }],
          },
        },
      }
    default:
      return { ok: true, payload: { kind: 'foreignKeys', foreignKeys: [] } }
  }
}
function gateway(): OperationGateway {
  return {
    run: vi.fn((req: { operation: { op: string; table?: string } }) =>
      Promise.resolve(outcome(req.operation.op, req.operation.table)),
    ) as OperationGateway['run'],
    cancel: vi.fn().mockResolvedValue(undefined),
    recentAudit: vi.fn().mockResolvedValue([]),
  }
}
function wrap(onOpen = vi.fn()) {
  render(
    <ThemeProvider theme={darkTheme}>
      <ErView gateway={gateway()} connectionId="c1" onOpenTable={onOpen} />
    </ThemeProvider>,
  )
  return onOpen
}

describe('ErView', () => {
  it('스키마 미선택 시 안내 문구를 보여준다', async () => {
    wrap()
    await waitFor(() =>
      expect((screen.getByLabelText('schema') as HTMLSelectElement).options.length).toBeGreaterThan(1),
    )
    expect(screen.getByText(/스키마를 선택/)).toBeTruthy()
  })

  it('스키마를 고르면 그래프 노드가 렌더된다', async () => {
    wrap()
    await waitFor(() => expect(screen.getByLabelText('schema')).toBeTruthy())
    fireEvent.change(screen.getByLabelText('schema'), { target: { value: 'public' } })
    await waitFor(() => expect(screen.getByText('orders')).toBeTruthy())
    expect(screen.getByText('users')).toBeTruthy()
  })

  it('노드 클릭 시 onOpenTable(schema, table)을 호출한다', async () => {
    const onOpen = wrap()
    await waitFor(() => expect(screen.getByLabelText('schema')).toBeTruthy())
    fireEvent.change(screen.getByLabelText('schema'), { target: { value: 'public' } })
    await waitFor(() => expect(screen.getByText('orders')).toBeTruthy())
    fireEvent.click(screen.getByText('orders'))
    expect(onOpen).toHaveBeenCalledWith('public', 'orders')
  })
})
