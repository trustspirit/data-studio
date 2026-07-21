// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { ThemeProvider, darkTheme } from '@renderer/shared/theme'
import { DataView } from '@renderer/features/data'
import type { OperationGateway, OperationOutcome } from '@renderer/gateways/ports/OperationGateway'

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, value: 800 })
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: 400 })
  Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', { configurable: true, value: () => ({ width: 800, height: 400, top: 0, left: 0, right: 800, bottom: 400, x: 0, y: 0, toJSON() {} }) })
})

function outcomeFor(op: string): OperationOutcome {
  if (op === 'listSchemas') return { ok: true, payload: { kind: 'schemas', schemas: [{ name: 'public' }] } }
  if (op === 'listTables') return { ok: true, payload: { kind: 'tables', tables: [{ schema: 'public', name: 'users', kind: 'table', estimatedRows: null }] } }
  // browse
  return { ok: true, payload: { kind: 'rows', rows: {
    requestId: 'r', columns: [{ name: 'id', type: '23' }], rows: [[{ t: 'int', v: 7 }]],
    page: { cursor: null, hasMore: false, rowCount: 1, bytes: 10 },
    meta: { durationMs: 1, truncatedRows: false, truncatedBytes: false, rowsAffected: null },
  } } }
}
function gateway(): OperationGateway {
  return {
    run: vi.fn((req: { operation: { op: string } }) => Promise.resolve(outcomeFor(req.operation.op))) as OperationGateway['run'],
    cancel: vi.fn().mockResolvedValue(undefined), recentAudit: vi.fn().mockResolvedValue([]),
  }
}
function wrap(ui: React.ReactElement) { return render(<ThemeProvider theme={darkTheme}>{ui}</ThemeProvider>) }

describe('DataView', () => {
  it('스키마를 펼쳐 테이블을 고르면 행이 그리드에 뜬다', async () => {
    wrap(<DataView gateway={gateway()} connectionId="c1" />)
    await waitFor(() => expect(screen.getByText(/public/)).toBeTruthy())
    fireEvent.click(screen.getByText(/public/))
    await waitFor(() => expect(screen.getByText('users')).toBeTruthy())
    fireEvent.click(screen.getByText('users'))
    await waitFor(() => expect(screen.getByText('7')).toBeTruthy()) // 셀 값
  })

  it('처음엔 안내 문구를 보여준다', async () => {
    wrap(<DataView gateway={gateway()} connectionId="c1" />)
    await waitFor(() => expect(screen.getByText(/public/)).toBeTruthy())
    expect(screen.getByText(/테이블을 선택/)).toBeTruthy()
  })
})
