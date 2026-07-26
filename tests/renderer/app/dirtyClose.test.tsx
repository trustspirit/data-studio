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
        onConnectionDirtyChange={vi.fn()}
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

  // 리뷰 지적(Finding 1): 다이얼로그를 여는 실제 트리거(탭의 × 컨트롤)는
  // ConfirmDialog의 자식이 아니라 ConnectionWorkspace 안의 형제다. 클릭이 DOM
  // 포커스를 그 트리거에 남기므로, 진짜 상호작용 경로를 재현하려면 다이얼로그
  // 루트가 아니라 "클릭이 남긴 실제 document.activeElement"에서 Escape를
  // 쏴야 한다 — 그래야 포커스 위치·버블링 경로를 우회하지 않는다.
  it('실제 닫기 컨트롤을 눌러 연 다이얼로그도 Escape로 취소된다(포커스 위치와 무관하게)', async () => {
    const { onCloseDocument } = renderWorkspace()
    await waitFor(() => expect(screen.getByText('Add row')).toBeTruthy())
    fireEvent.click(screen.getByText('Add row'))
    fireEvent.click(screen.getByTestId('doctab-close-table:public.orders'))
    expect(screen.getByTestId('confirm-close-doc')).toBeTruthy()

    const active = document.activeElement ?? document.body
    fireEvent.keyDown(active, { key: 'Escape' })

    expect(onCloseDocument).not.toHaveBeenCalled()
    expect(screen.queryByTestId('confirm-close-doc')).toBeNull()
  })

  // 리뷰 지적(Finding 3): onConfirm이 dirtyKeys에서 그 키를 지우는 줄은,
  // 재오픈된 DataView가 마운트 즉시 dirty:false를 보고해 우연히 자기치유되므로
  // 지워도 통과한다. onCloseDocument를 아무 것도 하지 않는 no-op으로 둬서(탭이
  // 실제로는 안 닫힌 것처럼) DataView를 그대로 마운트 상태로 유지해, 그 자기치유
  // 경로를 없앤 채로 close 사이트 자신의 정리 로직만 검증한다.
  it('확인 후 dirty 키가 지워진다 — 같은 탭을 다시 닫으면 확인 없이 처리된다', async () => {
    const { onCloseDocument } = renderWorkspace()
    await waitFor(() => expect(screen.getByText('Add row')).toBeTruthy())
    fireEvent.click(screen.getByText('Add row'))

    fireEvent.click(screen.getByTestId('doctab-close-table:public.orders'))
    expect(screen.getByTestId('confirm-close-doc')).toBeTruthy()
    fireEvent.click(screen.getByTestId('confirm-close-doc-ok'))
    expect(onCloseDocument).toHaveBeenCalledTimes(1)

    // onCloseDocument가 no-op이라 탭은 여전히 마운트돼 있고 편집도 그대로다 —
    // editor.dirty 값 자체는 바뀌지 않았으므로 DataView의 onDirtyChange effect는
    // 다시 돌지 않는다. 그런데도 두 번째 닫기 시도가 확인 없이 처리된다면, 그건
    // onConfirm이 close 시점에 dirtyKeys를 직접 지웠기 때문일 수밖에 없다.
    fireEvent.click(screen.getByTestId('doctab-close-table:public.orders'))
    expect(onCloseDocument).toHaveBeenCalledTimes(2)
    expect(screen.queryByTestId('confirm-close-doc')).toBeNull()
  })
})
