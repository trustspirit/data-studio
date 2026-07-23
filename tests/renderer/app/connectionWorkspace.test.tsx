// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { ThemeProvider, darkTheme } from '@renderer/shared/theme'
import { ConnectionWorkspace } from '@renderer/app/ConnectionWorkspace'
import type { OperationGateway, OperationOutcome } from '@renderer/gateways/ports/OperationGateway'
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
  }
}
function wrap(capabilities: readonly Capability[] = ['sql', 'schema', 'data']) {
  return render(
    <ThemeProvider theme={darkTheme}>
      <ConnectionWorkspace
        gateway={gateway()}
        connectionId="c1"
        connectionName="prod"
        capabilities={capabilities}
      />
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

  it('sql/schema/data 모두 있으면 4개 서브탭이 다 뜬다', () => {
    wrap(['sql', 'schema', 'data'])
    expect(screen.getByTestId('subtab-query')).toBeTruthy()
    expect(screen.getByTestId('subtab-structure')).toBeTruthy()
    expect(screen.getByTestId('subtab-data')).toBeTruthy()
    expect(screen.getByTestId('subtab-er')).toBeTruthy()
  })

  it('schema만 있으면 Structure/ER만 뜨고 Query/Data는 없다', () => {
    wrap(['schema'])
    expect(screen.queryByTestId('subtab-query')).toBeNull()
    expect(screen.queryByTestId('subtab-data')).toBeNull()
    expect(screen.getByTestId('subtab-structure')).toBeTruthy()
    expect(screen.getByTestId('subtab-er')).toBeTruthy()
  })

  it('sql만 있으면 Query만 뜬다', () => {
    wrap(['sql'])
    expect(screen.getByTestId('subtab-query')).toBeTruthy()
    expect(screen.queryByTestId('subtab-structure')).toBeNull()
    expect(screen.queryByTestId('subtab-data')).toBeNull()
    expect(screen.queryByTestId('subtab-er')).toBeNull()
  })

  it('document capability만 있으면 Documents만 뜨고 나머지는 없다', () => {
    wrap(['document'])
    expect(screen.getByTestId('subtab-documents')).toBeTruthy()
    expect(screen.queryByTestId('subtab-query')).toBeNull()
    expect(screen.queryByTestId('subtab-structure')).toBeNull()
    expect(screen.queryByTestId('subtab-data')).toBeNull()
    expect(screen.queryByTestId('subtab-er')).toBeNull()
  })

  it('keyvalue capability만 있으면 Key Browser만 뜨고 나머지는 없다', () => {
    wrap(['keyvalue'])
    expect(screen.getByTestId('subtab-keys')).toBeTruthy()
    expect(screen.queryByTestId('subtab-query')).toBeNull()
    expect(screen.queryByTestId('subtab-structure')).toBeNull()
    expect(screen.queryByTestId('subtab-data')).toBeNull()
    expect(screen.queryByTestId('subtab-er')).toBeNull()
    expect(screen.queryByTestId('subtab-documents')).toBeNull()
  })

  it('capability가 없으면 서브탭이 하나도 없다(빈 상태)', () => {
    wrap([])
    expect(screen.queryByTestId('subtab-query')).toBeNull()
    expect(screen.queryByTestId('subtab-structure')).toBeNull()
    expect(screen.queryByTestId('subtab-data')).toBeNull()
    expect(screen.queryByTestId('subtab-er')).toBeNull()
  })

  it('capability가 줄어드는 리렌더에서 사라진 뷰가 남아있지 않고 즉시 대체된다', async () => {
    const { rerender } = wrap(['sql', 'schema', 'data'])
    fireEvent.click(screen.getByTestId('subtab-data'))
    await waitFor(() => expect(screen.getByText(/public/)).toBeTruthy())

    // 같은 인스턴스를 data capability가 빠진 capabilities로 리렌더한다(마운트가 아니라 리렌더).
    rerender(
      <ThemeProvider theme={darkTheme}>
        <ConnectionWorkspace
          gateway={gateway()}
          connectionId="c1"
          connectionName="prod"
          capabilities={['sql']}
        />
      </ThemeProvider>,
    )

    // Data 서브탭은 사라져야 하고, view state가 useEffect로 나중에 보정되기 전에도
    // stale한 Data 뷰 본문이 한 커밋이라도 뜨면 안 된다 — query가 즉시 보여야 한다.
    expect(screen.queryByTestId('subtab-data')).toBeNull()
    expect(screen.getByText(/Query — prod/)).toBeTruthy()
  })
})
