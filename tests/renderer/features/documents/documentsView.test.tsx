// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ThemeProvider, darkTheme } from '@renderer/shared/theme'
import { DocumentsView } from '@renderer/features/documents'
import type { OperationGateway, OperationOutcome } from '@renderer/gateways/ports/OperationGateway'

interface GatewayOpts {
  findFails?: boolean
}

function outcomeFor(op: { op: string; collection?: string; filter?: string }, opts: GatewayOpts): OperationOutcome {
  if (op.op === 'listCollections') {
    return {
      ok: true,
      payload: {
        kind: 'rows',
        rows: {
          requestId: 'r',
          columns: [{ name: 'name', type: 'str' }],
          rows: [[{ t: 'str', v: 'users' }], [{ t: 'str', v: 'orders' }]],
          page: { cursor: null, hasMore: false, rowCount: 2, bytes: 10 },
          meta: { durationMs: 1, truncatedRows: false, truncatedBytes: false, rowsAffected: null },
        },
      },
    }
  }
  // find
  if (opts.findFails === true) return { ok: false, reason: 'query failed' }
  return {
    ok: true,
    payload: {
      kind: 'rows',
      rows: {
        requestId: 'r',
        columns: [{ name: '_doc', type: 'json' }],
        rows: [[{ t: 'json', v: '{"_id":{"$oid":"1"},"name":"Alice"}', truncated: false }]],
        page: { cursor: null, hasMore: false, rowCount: 1, bytes: 10 },
        meta: { durationMs: 1, truncatedRows: false, truncatedBytes: false, rowsAffected: null },
      },
    },
  }
}
function gateway(opts: GatewayOpts = {}): OperationGateway {
  return {
    run: vi.fn((req: { operation: { op: string; collection?: string; filter?: string } }) =>
      Promise.resolve(outcomeFor(req.operation, opts)),
    ) as OperationGateway['run'],
    cancel: vi.fn().mockResolvedValue(undefined),
    recentAudit: vi.fn().mockResolvedValue([]),
  }
}
function wrap(ui: React.ReactElement) {
  return render(<ThemeProvider theme={darkTheme}>{ui}</ThemeProvider>)
}

describe('DocumentsView', () => {
  it('마운트 시 컬렉션 목록을 보여준다', async () => {
    wrap(<DocumentsView gateway={gateway()} connectionId="c1" />)
    await waitFor(() => expect(screen.getByText('users')).toBeTruthy())
    expect(screen.getByText('orders')).toBeTruthy()
  })

  it('컬렉션 선택 후 Run을 누르면 find 결과가 prettified JSON으로 뜬다', async () => {
    const g = gateway()
    wrap(<DocumentsView gateway={g} connectionId="c1" />)
    await waitFor(() => expect(screen.getByText('users')).toBeTruthy())
    fireEvent.click(screen.getByText('users'))
    fireEvent.click(screen.getByText('Run'))

    await waitFor(() => expect(screen.getByText(/"name": "Alice"/)).toBeTruthy())
    const calls = (g.run as unknown as ReturnType<typeof vi.fn>).mock.calls as [{ operation: { op: string; collection?: string; filter?: string } }][]
    const findCall = calls.find((c) => c[0].operation.op === 'find')
    expect(findCall?.[0].operation).toEqual({ kind: 'document', op: 'find', collection: 'users', filter: '{}' })
  })

  it('필터를 바꾸고 Run을 누르면 바뀐 필터로 find를 호출한다', async () => {
    const g = gateway()
    wrap(<DocumentsView gateway={g} connectionId="c1" />)
    await waitFor(() => expect(screen.getByText('users')).toBeTruthy())
    fireEvent.click(screen.getByText('users'))
    fireEvent.change(screen.getByLabelText('filter'), { target: { value: '{"name":"Alice"}' } })
    fireEvent.click(screen.getByText('Run'))

    await waitFor(() => {
      const calls = (g.run as unknown as ReturnType<typeof vi.fn>).mock.calls as [{ operation: { op: string; filter?: string } }][]
      const findCall = calls.find((c) => c[0].operation.op === 'find')
      expect(findCall?.[0].operation.filter).toBe('{"name":"Alice"}')
    })
  })

  it('컬렉션 선택 전엔 Run이 비활성이다', async () => {
    wrap(<DocumentsView gateway={gateway()} connectionId="c1" />)
    await waitFor(() => expect(screen.getByText('users')).toBeTruthy())
    expect(screen.getByText('Run').closest('button')?.disabled).toBe(true)
  })

  it('find가 실패하면 오류 메시지를 보여준다', async () => {
    wrap(<DocumentsView gateway={gateway({ findFails: true })} connectionId="c1" />)
    await waitFor(() => expect(screen.getByText('users')).toBeTruthy())
    fireEvent.click(screen.getByText('users'))
    fireEvent.click(screen.getByText('Run'))
    await waitFor(() => expect(screen.getByText('query failed')).toBeTruthy())
  })
})
