// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
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
    ) as OperationGateway['run'],
    cancel: vi.fn().mockResolvedValue(undefined),
    recentAudit: vi.fn().mockResolvedValue([]),
    onStreamMessage: vi.fn(() => () => {}),
  }
}
function wrap(ui: React.ReactElement) {
  return render(<ThemeProvider theme={darkTheme}>{ui}</ThemeProvider>)
}

const USERS = { schema: 'public', table: 'users' }

describe('StructureView', () => {
  it('셸이 고른 테이블의 컬럼이 패널에 뜬다', async () => {
    wrap(<StructureView gateway={gateway()} connectionId="c1" selection={USERS} />)
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Columns' })).toBeTruthy())
    expect(screen.getByText('id')).toBeTruthy()
  })

  it('선택이 없으면 안내 문구를 보여준다', async () => {
    wrap(<StructureView gateway={gateway()} connectionId="c1" selection={null} />)
    await waitFor(() => expect(screen.getByText(/테이블을 선택/)).toBeTruthy())
  })

  it('자기 트리를 그리지 않는다 — 사이드바 트리가 앱에 하나뿐이다', async () => {
    wrap(<StructureView gateway={gateway()} connectionId="c1" selection={USERS} />)
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Columns' })).toBeTruthy())
    // 스키마를 나열하지도, 목록을 읽어 오지도 않는다.
    expect(screen.queryByText(/^▸ public$|^▾ public$/)).toBeNull()
  })

  it('선택이 풀리면 안내 문구로 돌아간다', async () => {
    const gw = gateway()
    const { rerender } = render(
      <ThemeProvider theme={darkTheme}>
        <StructureView gateway={gw} connectionId="c1" selection={USERS} />
      </ThemeProvider>,
    )
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Columns' })).toBeTruthy())

    rerender(
      <ThemeProvider theme={darkTheme}>
        <StructureView gateway={gw} connectionId="c1" selection={null} />
      </ThemeProvider>,
    )
    await waitFor(() => expect(screen.getByText(/테이블을 선택/)).toBeTruthy())
  })

  it('연결이 바뀌면 열려 있던 디자이너가 닫힌다', async () => {
    const gw = gateway()
    const { rerender } = render(
      <ThemeProvider theme={darkTheme}>
        <StructureView gateway={gw} connectionId="c1" selection={USERS} engine="postgres" />
      </ThemeProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('ddl-open-add-column')).toBeTruthy())
    screen.getByTestId('ddl-open-add-column').click()
    await waitFor(() => expect(screen.getByTestId('table-designer')).toBeTruthy())

    // 다른 연결의 폼이 남아 있으면 엉뚱한 서버에 DDL을 쏠 수 있다.
    rerender(
      <ThemeProvider theme={darkTheme}>
        <StructureView gateway={gw} connectionId="c2" selection={USERS} engine="postgres" />
      </ThemeProvider>,
    )
    await waitFor(() => expect(screen.queryByTestId('table-designer')).toBeNull())
  })
})
