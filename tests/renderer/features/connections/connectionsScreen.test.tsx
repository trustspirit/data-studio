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
})
