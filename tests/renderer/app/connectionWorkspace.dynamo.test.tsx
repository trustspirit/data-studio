// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ThemeProvider, darkTheme } from '@renderer/shared/theme'
import { ConnectionWorkspace } from '@renderer/app/ConnectionWorkspace'
import type { OperationGateway, OperationOutcome } from '@renderer/gateways/ports/OperationGateway'

const gateway: OperationGateway = {
  run: vi.fn(
    async (): Promise<OperationOutcome> => ({
      ok: true,
      payload: {
        kind: 'rows',
        rows: {
          requestId: 'r',
          columns: [],
          rows: [],
          page: { cursor: null, hasMore: false, rowCount: 0, bytes: 0 },
          meta: { durationMs: 0, truncatedRows: false, truncatedBytes: false, rowsAffected: null },
        },
      },
    }),
  ),
  cancel: vi.fn(async () => {}),
  recentAudit: vi.fn(async () => []),
  onStreamMessage: vi.fn(() => () => {}),
}

describe('ConnectionWorkspace — dynamo', () => {
  it('dynamo capability면 Items 탭을 보인다', () => {
    render(
      <ThemeProvider theme={darkTheme}>
        <ConnectionWorkspace gateway={gateway} connectionId="c1" connectionName="n" capabilities={['dynamo']} />
      </ThemeProvider>,
    )
    expect(screen.getByTestId('subtab-dynamo')).toBeTruthy()
    expect(screen.getByTestId('subtab-dynamo').textContent).toBe('Items')
  })

  it('dynamo capability가 없으면 Items 탭이 없다', () => {
    render(
      <ThemeProvider theme={darkTheme}>
        <ConnectionWorkspace gateway={gateway} connectionId="c1" connectionName="n" capabilities={['sql']} />
      </ThemeProvider>,
    )
    expect(screen.queryByTestId('subtab-dynamo')).toBeNull()
  })
})
