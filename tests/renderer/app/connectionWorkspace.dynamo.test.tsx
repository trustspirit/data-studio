// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ThemeProvider, darkTheme } from '@renderer/shared/theme'
import { ConnectionWorkspace } from '@renderer/app/ConnectionWorkspace'
import type { TabSet } from '@renderer/app/model/useDocumentTabs'
import type { OperationGateway, OperationOutcome } from '@renderer/gateways/ports/OperationGateway'
import type { Capability } from '@shared/types/capability'

const gateway: OperationGateway = {
  run: vi.fn(
    (): Promise<OperationOutcome> =>
      Promise.resolve({
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
  cancel: vi.fn(() => Promise.resolve()),
  recentAudit: vi.fn(() => Promise.resolve([])),
  onStreamMessage: vi.fn(() => () => {}),
}

const ITEMS: TabSet = { documents: [{ kind: 'items' }], activeKey: 'items' }
const NOTHING: TabSet = { documents: [], activeKey: null }

function wrap(capabilities: readonly Capability[], tabs: TabSet) {
  return render(
    <ThemeProvider theme={darkTheme}>
      <ConnectionWorkspace
        gateway={gateway}
        connectionId="c1"
        connectionName="n"
        capabilities={capabilities}
        tabs={tabs}
        onOpenDocument={vi.fn()}
        onCloseDocument={vi.fn()}
        onActivateDocument={vi.fn()}
        onNewQuery={vi.fn()}
      />
    </ThemeProvider>,
  )
}

describe('ConnectionWorkspace — dynamo', () => {
  it('dynamo 연결의 Items 문서를 그린다', () => {
    wrap(['dynamo'], ITEMS)
    expect(screen.getByTestId('docpane-items')).toBeTruthy()
  })

  it('열 수 있는 것이 Items 하나뿐이면 탭 줄을 감춘다', () => {
    wrap(['dynamo'], ITEMS)
    expect(screen.queryByRole('tablist')).toBeNull()
  })

  it('dynamo capability가 없으면 Items 문서가 없다', () => {
    wrap(['sql'], NOTHING)
    expect(screen.queryByTestId('docpane-items')).toBeNull()
  })
})
