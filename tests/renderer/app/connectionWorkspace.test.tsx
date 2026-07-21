// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { ThemeProvider, darkTheme } from '@renderer/shared/theme'
import { ConnectionWorkspace } from '@renderer/app/ConnectionWorkspace'
import type { OperationGateway, OperationOutcome } from '@renderer/gateways/ports/OperationGateway'

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
    run: vi.fn((req: { operation: { op?: string } }): Promise<OperationOutcome> => {
      if (req.operation.op === 'listSchemas')
        return Promise.resolve({ ok: true, payload: { kind: 'schemas', schemas: [{ name: 'public' }] } })
      return Promise.resolve({ ok: true, payload: { kind: 'tables', tables: [] } })
    }) as OperationGateway['run'],
    cancel: vi.fn().mockResolvedValue(undefined),
    recentAudit: vi.fn().mockResolvedValue([]),
  }
}
function wrap() {
  return render(
    <ThemeProvider theme={darkTheme}>
      <ConnectionWorkspace gateway={gateway()} connectionId="c1" connectionName="prod" />
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
})
