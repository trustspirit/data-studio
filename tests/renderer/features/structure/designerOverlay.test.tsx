// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ThemeProvider, darkTheme } from '@renderer/shared/theme'
import { DesignerOverlay } from '@renderer/features/structure/ui/DesignerOverlay'
import type { OperationGateway, OperationOutcome } from '@renderer/gateways/ports/OperationGateway'

function gateway(outcome: OperationOutcome): OperationGateway {
  return {
    run: vi.fn(() => Promise.resolve(outcome)),
    cancel: vi.fn(() => Promise.resolve()),
  } as unknown as OperationGateway
}

const OK: OperationOutcome = {
  ok: true,
  payload: {
    kind: 'rows',
    rows: {
      requestId: 'r',
      columns: [],
      rows: [],
      page: { cursor: null, hasMore: false, rowCount: 0, bytes: 0 },
      meta: { durationMs: 1, truncatedRows: false, truncatedBytes: false, rowsAffected: 0 },
    },
  },
} as unknown as OperationOutcome

const FAILED: OperationOutcome = {
  ok: false,
  reason: 'error',
  detail: 'relation "orders" already exists',
}

function renderOverlay(g: OperationGateway, onRan = vi.fn(), onClose = vi.fn()) {
  render(
    <ThemeProvider theme={darkTheme}>
      <DesignerOverlay
        gateway={g}
        connectionId="c1"
        dialect="postgres"
        mode="create"
        target=""
        selection={null}
        schemas={['public']}
        existing={{ columns: [], indexes: [] }}
        onClose={onClose}
        onRan={onRan}
      />
    </ThemeProvider>,
  )
  return { onRan, onClose }
}

/** create 모드 폼을 실행 가능한 상태까지 채운다 — 실행 버튼은 폼이 유효할 때만 켜진다. */
function fillValidCreateForm() {
  fireEvent.change(screen.getByTestId('ddl-table'), { target: { value: 'orders' } })
  fireEvent.change(screen.getByTestId('ddl-col-name-0'), { target: { value: 'id' } })
  fireEvent.change(screen.getByTestId('ddl-col-type-0'), { target: { value: 'bigint' } })
}

describe('DesignerOverlay', () => {
  it('디자이너를 오버레이 안에 띄운다', () => {
    renderOverlay(gateway(OK))
    expect(screen.getByTestId('designer-overlay')).toBeTruthy()
  })

  it('배경을 누르면 닫힌다', () => {
    const { onClose } = renderOverlay(gateway(OK))
    fireEvent.click(screen.getByTestId('designer-backdrop'))
    expect(onClose).toHaveBeenCalled()
  })

  it('Escape로 닫힌다', () => {
    const { onClose } = renderOverlay(gateway(OK))
    fireEvent.keyDown(screen.getByTestId('designer-overlay'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('DDL이 성공하면 onRan이 정확히 한 번, onClose가 정확히 한 번 불린다', async () => {
    // onClose는 두 곳에서 부를 수 있다 — DesignerOverlay의 runDdl과 TableDesigner의 run()
    // 둘 다 성공 시 닫으려 하면 두 번 불린다. 닫는 책임은 TableDesigner 하나여야 한다.
    const g = gateway(OK)
    const { onRan, onClose } = renderOverlay(g)
    fillValidCreateForm()
    fireEvent.click(screen.getByTestId('ddl-run'))
    await waitFor(() => expect(onRan).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(g.run).toHaveBeenCalledTimes(1)
  })

  it('DDL이 실패하면 onRan·onClose를 부르지 않고 이유를 보여준다', async () => {
    const g = gateway(FAILED)
    const { onRan, onClose } = renderOverlay(g)
    fillValidCreateForm()
    fireEvent.click(screen.getByTestId('ddl-run'))
    await waitFor(() => expect(g.run).toHaveBeenCalled())
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('relation "orders" already exists'),
    )
    expect(onRan).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    // 실패해도 사용자가 채운 폼은 그대로 남는다 — 반쯤 쓴 DDL을 잃지 않는다.
    expect((screen.getByTestId('ddl-table') as HTMLInputElement).value).toBe('orders')
  })
})
