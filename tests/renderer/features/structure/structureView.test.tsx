// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ThemeProvider, darkTheme } from '@renderer/shared/theme'
import { StructureView } from '@renderer/features/structure'
import type { OperationGateway, OperationOutcome } from '@renderer/gateways/ports/OperationGateway'

function outcomeFor(op: string, schema?: string, table?: string): OperationOutcome {
  switch (op) {
    case 'listSchemas':
      return { ok: true, payload: { kind: 'schemas', schemas: [{ name: 'public' }] } }
    case 'listTables':
      return {
        ok: true,
        payload: {
          kind: 'tables',
          tables: [{ schema: schema ?? 'public', name: 'users', kind: 'table', estimatedRows: null }],
        },
      }
    case 'describeTable':
      return {
        ok: true,
        payload: {
          kind: 'tableDetail',
          detail: {
            schema: 'public',
            name: table ?? 'users',
            columns: [
              { name: 'id', type: 'int8', nullable: false, defaultValue: null, primaryKeyOrdinal: 1 },
            ],
          },
        },
      }
    case 'listIndexes':
      return { ok: true, payload: { kind: 'indexes', indexes: [] } }
    default:
      return { ok: true, payload: { kind: 'foreignKeys', foreignKeys: [] } }
  }
}

function gateway(): OperationGateway {
  return {
    run: vi.fn((req: { operation: { op: string; schema?: string; table?: string } }) =>
      Promise.resolve(outcomeFor(req.operation.op, req.operation.schema, req.operation.table)),
    ),
    cancel: vi.fn().mockResolvedValue(undefined),
    recentAudit: vi.fn().mockResolvedValue([]),
  }
}
function wrap(ui: React.ReactElement) {
  return render(<ThemeProvider theme={darkTheme}>{ui}</ThemeProvider>)
}

describe('StructureView', () => {
  it('스키마를 펼쳐 테이블을 고르면 컬럼이 패널에 뜬다', async () => {
    wrap(<StructureView gateway={gateway()} connectionId="c1" />)
    await waitFor(() => expect(screen.getByText(/public/)).toBeTruthy())
    fireEvent.click(screen.getByText(/public/))
    await waitFor(() => expect(screen.getByText('users')).toBeTruthy())
    fireEvent.click(screen.getByText('users'))
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Columns' })).toBeTruthy())
    expect(screen.getByText('id')).toBeTruthy()
  })

  it('처음엔 안내 문구를 보여준다', async () => {
    wrap(<StructureView gateway={gateway()} connectionId="c1" />)
    await waitFor(() => expect(screen.getByText(/public/)).toBeTruthy())
    expect(screen.getByText(/테이블을 선택/)).toBeTruthy()
  })
})
