// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { ThemeProvider, darkTheme } from '@renderer/shared/theme'
import { QueryWorkspace } from '@renderer/features/query'
import type { OperationGateway } from '@renderer/gateways/ports/OperationGateway'
import type { ResultSet } from '@shared/types/resultSet'

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ width: 800, height: 400, top: 0, left: 0, right: 800, bottom: 400, x: 0, y: 0, toJSON() {} }),
  })
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    value: 800,
  })
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    value: 400,
  })
})
function rs(): ResultSet {
  return {
    requestId: 'r', columns: [{ name: 'id', type: '23' }], rows: [[{ t: 'int', v: 7 }]],
    page: { cursor: null, hasMore: false, rowCount: 1, bytes: 10 },
    meta: { durationMs: 1, truncatedRows: false, truncatedBytes: false, rowsAffected: null },
  }
}
function wrap(node: React.ReactNode) {
  return render(<ThemeProvider theme={darkTheme}>{node}</ThemeProvider>)
}

describe('QueryWorkspace', () => {
  it('Run이 게이트웨이를 부르고 결과 그리드를 보인다', async () => {
    const gateway: OperationGateway = {
      run: vi.fn().mockResolvedValue({ ok: true as const, payload: { kind: 'rows' as const, rows: rs() } }),
      cancel: vi.fn().mockResolvedValue(undefined),
      recentAudit: vi.fn().mockResolvedValue([]),
    }
    wrap(<QueryWorkspace gateway={gateway} connectionId="c1" connectionName="prod" />)
    fireEvent.click(screen.getByText('Run'))
    // eslint-disable-next-line @typescript-eslint/unbound-method -- vi.fn mock, no `this` binding involved
    await waitFor(() => expect(gateway.run).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByText('7')).toBeTruthy())
  })

  it('오류를 배너로 보인다', async () => {
    const gateway: OperationGateway = {
      run: vi.fn().mockResolvedValue({ ok: false as const, reason: 'syntax error' }),
      cancel: vi.fn().mockResolvedValue(undefined),
      recentAudit: vi.fn().mockResolvedValue([]),
    }
    wrap(<QueryWorkspace gateway={gateway} connectionId="c1" connectionName="prod" />)
    fireEvent.click(screen.getByText('Run'))
    await waitFor(() => expect(screen.getByText(/syntax error/)).toBeTruthy())
  })

  it('성공 후 실패하면 이전 그리드를 지우고 오류만 보인다', async () => {
    const gateway: OperationGateway = {
      run: vi.fn()
        .mockResolvedValueOnce({ ok: true as const, payload: { kind: 'rows' as const, rows: rs() } })
        .mockResolvedValueOnce({ ok: false as const, reason: 'syntax error' }),
      cancel: vi.fn().mockResolvedValue(undefined),
      recentAudit: vi.fn().mockResolvedValue([]),
    }
    wrap(<QueryWorkspace gateway={gateway} connectionId="c1" connectionName="prod" />)
    fireEvent.click(screen.getByText('Run'))
    await waitFor(() => expect(screen.getByText('7')).toBeTruthy())
    expect(screen.getByText('id')).toBeTruthy()

    fireEvent.click(screen.getByText('Run'))
    await waitFor(() => expect(screen.getByText(/syntax error/)).toBeTruthy())
    expect(screen.queryByText('id')).toBeNull()
  })
})
