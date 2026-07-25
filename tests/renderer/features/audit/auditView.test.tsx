// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ThemeProvider, darkTheme } from '@renderer/shared/theme'
import { AuditView } from '@renderer/features/audit'
import type { AuditEntry, OperationGateway } from '@renderer/gateways/ports/OperationGateway'

function entry(over: Partial<AuditEntry> = {}): AuditEntry {
  return {
    requestId: 'r1',
    connectionId: 'c1',
    actorType: 'user',
    actorId: null,
    statement: 'SELECT 1',
    outcome: 'allowed',
    at: 1_700_000_000_000,
    ...over,
  }
}

function fakeGateway(entries: readonly AuditEntry[] | Error) {
  const recentAudit = vi.fn(() =>
    entries instanceof Error ? Promise.reject(entries) : Promise.resolve(entries),
  )
  const gateway: OperationGateway = {
    run: vi.fn(),
    cancel: vi.fn(),
    recentAudit,
    onStreamMessage: vi.fn(() => () => {}),
  }
  return { gateway, recentAudit }
}

function wrap(ui: React.ReactElement) {
  return render(<ThemeProvider theme={darkTheme}>{ui}</ThemeProvider>)
}

describe('AuditView', () => {
  it('마운트 시 최근 감사 항목을 불러와 표로 보여준다', async () => {
    const { gateway, recentAudit } = fakeGateway([
      entry(),
      entry({
        requestId: 'r2',
        actorType: 'ai',
        actorId: 's1',
        statement: 'UPDATE users SET x=1',
        outcome: 'denied',
      }),
    ])
    wrap(<AuditView gateway={gateway} />)

    await waitFor(() => expect(screen.getByTestId('audit-table')).toBeTruthy())
    expect(recentAudit).toHaveBeenCalledWith(200)
    expect(screen.getByText('SELECT 1')).toBeTruthy()
    expect(screen.getByText('UPDATE users SET x=1')).toBeTruthy()
    expect(screen.getByText('ai')).toBeTruthy()
    expect(screen.getByText('denied')).toBeTruthy()
    expect(screen.getByText('2 entries')).toBeTruthy()
  })

  it('비어 있으면 안내 문구를 보여준다', async () => {
    const { gateway } = fakeGateway([])
    wrap(<AuditView gateway={gateway} />)
    await waitFor(() => expect(screen.getByText(/감사 기록이 없습니다/)).toBeTruthy())
  })

  it('Refresh를 누르면 다시 조회한다', async () => {
    const { gateway, recentAudit } = fakeGateway([entry()])
    wrap(<AuditView gateway={gateway} />)
    await waitFor(() => expect(screen.getByTestId('audit-table')).toBeTruthy())

    fireEvent.click(screen.getByTestId('audit-refresh'))
    await waitFor(() => expect(recentAudit).toHaveBeenCalledTimes(2))
  })

  it('조회 실패는 배너로 보여준다', async () => {
    const { gateway } = fakeGateway(new Error('ipc broken'))
    wrap(<AuditView gateway={gateway} />)
    await waitFor(() => expect(screen.getByText(/ipc broken/)).toBeTruthy())
  })
})
