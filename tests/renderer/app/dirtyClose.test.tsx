// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { ThemeProvider, darkTheme } from '@renderer/shared/theme'
import { ConnectionWorkspace } from '@renderer/app/ConnectionWorkspace'
import type { Capability } from '@shared/types/capability'
import type { OperationGateway } from '@renderer/gateways/ports/OperationGateway'

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ width: 800, height: 400, top: 0, left: 0, right: 800, bottom: 400, x: 0, y: 0, toJSON() {} }),
  })
})

// describeTable은 PK를 주고(편집 가능), browse는 행 하나를 준다.
function gateway(): OperationGateway {
  return {
    run: vi.fn((req: { operation: { op?: string } }) => {
      if (req.operation.op === 'describeTable')
        return Promise.resolve({
          ok: true,
          payload: {
            kind: 'tableDetail',
            detail: {
              schema: 'public',
              name: 'orders',
              columns: [{ name: 'id', type: 'int8', nullable: false, defaultValue: null, primaryKeyOrdinal: 1 }],
            },
          },
        })
      if (req.operation.op === 'listIndexes')
        return Promise.resolve({ ok: true, payload: { kind: 'indexes', indexes: [] } })
      if (req.operation.op === 'listForeignKeys')
        return Promise.resolve({ ok: true, payload: { kind: 'foreignKeys', foreignKeys: [] } })
      return Promise.resolve({
        ok: true,
        payload: {
          kind: 'rows',
          rows: {
            requestId: 'r',
            columns: [{ name: 'id', type: '23' }],
            rows: [[{ t: 'int', v: 1 }]],
            page: { cursor: null, hasMore: false, rowCount: 1, bytes: 8 },
            meta: { durationMs: 1, truncatedRows: false, truncatedBytes: false, rowsAffected: null },
          },
        },
      })
    }),
    cancel: vi.fn(() => Promise.resolve()),
  } as unknown as OperationGateway
}

function renderWorkspace(onCloseDocument = vi.fn()) {
  render(
    <ThemeProvider theme={darkTheme}>
      <ConnectionWorkspace
        gateway={gateway()}
        connectionId="c1"
        connectionName="pg-dev"
        capabilities={['sql', 'schema', 'data'] as Capability[]}
        engine="postgres"
        tabs={{
          documents: [{ kind: 'table', schema: 'public', table: 'orders' }],
          activeKey: 'table:public.orders',
        }}
        onOpenDocument={vi.fn()}
        onCloseDocument={onCloseDocument}
        onActivateDocument={vi.fn()}
        onNewQuery={vi.fn()}
      />
    </ThemeProvider>,
  )
  return { onCloseDocument }
}

describe('편집 중 탭 닫기', () => {
  it('편집이 없으면 바로 닫는다', () => {
    const { onCloseDocument } = renderWorkspace()
    fireEvent.click(screen.getByTestId('doctab-close-table:public.orders'))
    expect(onCloseDocument).toHaveBeenCalledWith('table:public.orders')
  })

  it('스테이징된 편집이 있으면 확인을 먼저 받는다', async () => {
    const { onCloseDocument } = renderWorkspace()
    // 행 추가로 편집을 스테이징한다.
    await waitFor(() => expect(screen.getByText('Add row')).toBeTruthy())
    fireEvent.click(screen.getByText('Add row'))
    fireEvent.click(screen.getByTestId('doctab-close-table:public.orders'))
    expect(onCloseDocument).not.toHaveBeenCalled()
    expect(screen.getByTestId('confirm-close-doc')).toBeTruthy()
    fireEvent.click(screen.getByTestId('confirm-close-doc-ok'))
    expect(onCloseDocument).toHaveBeenCalledWith('table:public.orders')
  })

  it('확인에서 취소하면 탭이 그대로 남는다', async () => {
    const { onCloseDocument } = renderWorkspace()
    await waitFor(() => expect(screen.getByText('Add row')).toBeTruthy())
    fireEvent.click(screen.getByText('Add row'))
    fireEvent.click(screen.getByTestId('doctab-close-table:public.orders'))
    fireEvent.click(screen.getByTestId('confirm-close-doc-cancel'))
    expect(onCloseDocument).not.toHaveBeenCalled()
    expect(screen.queryByTestId('confirm-close-doc')).toBeNull()
  })
})
