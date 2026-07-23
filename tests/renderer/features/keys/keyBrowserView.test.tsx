// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ThemeProvider, darkTheme } from '@renderer/shared/theme'
import { KeyBrowserView } from '@renderer/features/keys/KeyBrowserView'
import type { OperationGateway, OperationOutcome } from '@renderer/gateways/ports/OperationGateway'

interface GatewayOpts {
  scanFails?: boolean
}

/** scan은 key 행을, get은 value 행을 준다. op으로 분기하는 가짜 게이트. */
function outcomeFor(op: { op: string }, opts: GatewayOpts): OperationOutcome {
  if (op.op === 'scan') {
    if (opts.scanFails === true) return { ok: false, reason: 'scan failed' }
    return {
      ok: true,
      payload: {
        kind: 'rows',
        rows: {
          requestId: 'r',
          columns: [],
          rows: [[{ t: 'str', v: 'u:1' }, { t: 'str', v: 'string' }, { t: 'int', v: -1 }]],
          page: { cursor: null, hasMore: false, rowCount: 1, bytes: 10 },
          meta: { durationMs: 1, truncatedRows: false, truncatedBytes: false, rowsAffected: null },
        },
      },
    }
  }
  // get
  return {
    ok: true,
    payload: {
      kind: 'rows',
      rows: {
        requestId: 'r',
        columns: [],
        rows: [[{ t: 'str', v: 'string' }, { t: 'int', v: -1 }, { t: 'json', v: '"hello"', truncated: false }]],
        page: { cursor: null, hasMore: false, rowCount: 1, bytes: 10 },
        meta: { durationMs: 1, truncatedRows: false, truncatedBytes: false, rowsAffected: null },
      },
    },
  }
}

function gateway(opts: GatewayOpts = {}): OperationGateway {
  return {
    run: vi.fn((req: { operation: { op: string } }) =>
      Promise.resolve(outcomeFor(req.operation, opts)),
    ) as OperationGateway['run'],
    cancel: vi.fn().mockResolvedValue(undefined),
    recentAudit: vi.fn().mockResolvedValue([]),
  }
}

function wrap(ui: React.ReactElement) {
  return render(<ThemeProvider theme={darkTheme}>{ui}</ThemeProvider>)
}

describe('KeyBrowserView', () => {
  it('Run이 scan해 키를 보여주고, 키를 누르면 값을 보여준다', async () => {
    wrap(<KeyBrowserView gateway={gateway()} connectionId="c1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Run' }))
    await waitFor(() => expect(screen.getByText('u:1')).toBeTruthy())
    fireEvent.click(screen.getByText('u:1'))
    await waitFor(() => expect(screen.getByText(/hello/)).toBeTruthy())
  })

  it('scan이 실패하면 오류 메시지를 보여준다', async () => {
    wrap(<KeyBrowserView gateway={gateway({ scanFails: true })} connectionId="c1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Run' }))
    await waitFor(() => expect(screen.getByText('scan failed')).toBeTruthy())
  })

  it('키 선택 전엔 안내 문구를 보여준다', () => {
    wrap(<KeyBrowserView gateway={gateway()} connectionId="c1" />)
    expect(screen.getByText('키를 선택하세요.')).toBeTruthy()
  })
})
