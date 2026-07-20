// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ThemeProvider, darkTheme } from '@renderer/shared/theme'
import { GatewayProvider } from '@renderer/app/GatewayProvider'
import { buildGateways } from '@renderer/app/container'
import type { DataconBridge } from '@renderer/gateways/ipc/ipcInvoke'
import { ConnectionsScreen } from '@renderer/features/connections'

function bridgeWith(list: unknown[]): DataconBridge {
  const store = [...list]
  return {
    invoke: vi.fn((channel: string, input: unknown): Promise<unknown> => {
      if (channel === 'connection:list') return Promise.resolve({ ok: true, value: store })
      if (channel === 'connection:save') {
        store.push(input)
        return Promise.resolve({ ok: true, value: null })
      }
      if (channel === 'connection:delete') return Promise.resolve({ ok: true, value: null })
      return Promise.resolve({ ok: false, code: 'internal_error' })
    }),
  }
}

function renderScreen(bridge: DataconBridge) {
  return render(
    <ThemeProvider theme={darkTheme}>
      <GatewayProvider gateways={buildGateways(bridge)}>
        <ConnectionsScreen />
      </GatewayProvider>
    </ThemeProvider>,
  )
}

describe('ConnectionsScreen', () => {
  it('로드한 연결을 목록에 표시한다', async () => {
    const conn = {
      id: 'a', name: 'prod', engine: 'postgres', host: 'h', port: 5432, database: 'd',
      username: 'u', tlsMode: 'disable', aiReadOnlyUsername: null, maskedColumnPatterns: [],
    }
    renderScreen(bridgeWith([conn]))
    await waitFor(() => expect(screen.getByText('prod')).toBeTruthy())
  })

  it('검증 실패 시 저장하지 않고 오류를 표시한다', async () => {
    const bridge = bridgeWith([])
    renderScreen(bridge)
    // New → 빈 폼(name 비어 있음) → Save
    fireEvent.click(screen.getByText(/New/i))
    fireEvent.click(screen.getByText('Save'))
    await waitFor(() => expect(screen.getByText(/Too small|required|expected/i)).toBeTruthy())
    // 검증을 통과 못 했으니 save 채널은 호출되지 않아야 한다.
    // eslint-disable-next-line @typescript-eslint/unbound-method -- vi.fn mock, no `this` binding involved
    const calls = vi.mocked(bridge.invoke).mock.calls.map((c) => c[0])
    expect(calls).not.toContain('connection:save')
  })

  it('레코드를 전환하면 삭제 확인 상태가 초기화된다', async () => {
    const connA = {
      id: 'a', name: 'A', engine: 'postgres', host: 'h', port: 5432, database: 'd',
      username: 'u', tlsMode: 'disable', aiReadOnlyUsername: null, maskedColumnPatterns: [],
    }
    const connB = {
      id: 'b', name: 'B', engine: 'postgres', host: 'h', port: 5432, database: 'd',
      username: 'u', tlsMode: 'disable', aiReadOnlyUsername: null, maskedColumnPatterns: [],
    }
    renderScreen(bridgeWith([connA, connB]))
    await waitFor(() => expect(screen.getByText('A')).toBeTruthy())

    // A를 선택하고 삭제를 눌러 확인 상태로 만든다.
    fireEvent.click(screen.getByText('A'))
    await waitFor(() => expect(screen.getByText('Delete')).toBeTruthy())
    fireEvent.click(screen.getByText('Delete'))
    await waitFor(() => expect(screen.getByText(/Confirm delete/i)).toBeTruthy())

    // B로 전환하면 B의 폼은 확인 상태가 아니어야 한다.
    fireEvent.click(screen.getByText('B'))
    await waitFor(() => expect(screen.queryByText(/Confirm delete/i)).toBeNull())
    expect(screen.getByText('Delete')).toBeTruthy()
  })
})
