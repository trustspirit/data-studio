// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { ThemeProvider, darkTheme } from '@renderer/shared/theme'
import { ConnectionWorkspace } from '@renderer/app/ConnectionWorkspace'
import type { OperationGateway, OperationOutcome } from '@renderer/gateways/ports/OperationGateway'

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
  }
}
function wrap() {
  return render(
    <ThemeProvider theme={darkTheme}>
      <ConnectionWorkspace gateway={gateway()} connectionId="c1" connectionName="prod" />
    </ThemeProvider>,
  )
}

describe('ConnectionWorkspace', () => {
  it('기본은 Query 서브뷰다', () => {
    wrap()
    expect(screen.getByText(/Query — prod/)).toBeTruthy()
  })

  it('Structure 서브탭으로 전환하면 스키마 네비가 뜬다', async () => {
    wrap()
    fireEvent.click(screen.getByTestId('subtab-structure'))
    await waitFor(() => expect(screen.getByText(/public/)).toBeTruthy())
    // Query 헤더는 더 이상 없다.
    expect(screen.queryByText(/Query — prod/)).toBeNull()
  })

  it('다시 Query 서브탭으로 돌아올 수 있다', async () => {
    wrap()
    fireEvent.click(screen.getByTestId('subtab-structure'))
    await waitFor(() => expect(screen.getByText(/public/)).toBeTruthy())
    fireEvent.click(screen.getByTestId('subtab-query'))
    expect(screen.getByText(/Query — prod/)).toBeTruthy()
  })

  it('Data 서브탭으로 전환하면 데이터 뷰가 뜬다', async () => {
    wrap()
    fireEvent.click(screen.getByTestId('subtab-data'))
    await waitFor(() => expect(screen.getByText(/public/)).toBeTruthy())
    // Query 헤더는 더 이상 없다.
    expect(screen.queryByText(/Query — /)).toBeNull()
  })

  it('ER 서브탭으로 전환하면 스키마 셀렉터가 뜬다', async () => {
    wrap()
    fireEvent.click(screen.getByTestId('subtab-er'))
    await waitFor(() => expect(screen.getByLabelText('schema')).toBeTruthy())
  })

  it('ER에서 노드를 클릭하면 Structure 뷰가 그 테이블을 연다', async () => {
    wrap()
    fireEvent.click(screen.getByTestId('subtab-er'))
    await waitFor(() => expect(screen.getByLabelText('schema')).toBeTruthy())
    fireEvent.change(screen.getByLabelText('schema'), { target: { value: 'public' } })
    await waitFor(() => expect(screen.getByText('orders')).toBeTruthy())
    fireEvent.click(screen.getByText('orders'))
    // Structure 뷰로 전환되고 orders의 컬럼이 패널에 뜬다.
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Columns' })).toBeTruthy())
  })
})
