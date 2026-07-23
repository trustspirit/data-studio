// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { ThemeProvider, darkTheme } from '@renderer/shared/theme'
import { GatewayProvider } from '@renderer/app/GatewayProvider'
import { buildGateways } from '@renderer/app/container'
import { AppShell } from '@renderer/app/AppShell'
import type { DataconBridge } from '@renderer/gateways/ipc/ipcInvoke'

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ width: 800, height: 400, top: 0, left: 0, right: 800, bottom: 400, x: 0, y: 0, toJSON() {} }),
  })
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    value: 800,
  })
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    value: 400,
  })
})

function bridgeWith(conns: unknown[]): DataconBridge {
  return {
    invoke: vi.fn((channel: string) => {
      if (channel === 'connection:list') return Promise.resolve({ ok: true, value: conns })
      if (channel === 'secrets:status') return Promise.resolve({ ok: true, value: { persistent: true } })
      if (channel === 'secrets:has') return Promise.resolve({ ok: true, value: { exists: false } })
      if (channel === 'connection:open')
        return Promise.resolve({ ok: true, value: { opened: true, capabilities: ['sql', 'schema', 'data'] } })
      if (channel === 'connection:status') return Promise.resolve({ ok: true, value: { status: 'ready' } })
      return Promise.resolve({ ok: true, value: null })
    }),
  }
}
function conn(id: string, name: string) {
  return { id, name, engine: 'postgres', host: 'h', port: 5432, database: 'd', username: 'u', tlsMode: 'disable', aiReadOnlyUsername: null, maskedColumnPatterns: [] }
}
function wrap(bridge: DataconBridge) {
  return render(
    <ThemeProvider theme={darkTheme}>
      <GatewayProvider gateways={buildGateways(bridge)}>
        <AppShell />
      </GatewayProvider>
    </ThemeProvider>,
  )
}

describe('AppShell', () => {
  it('내비 레일에 Connections/Workspace 탭이 있고 기본은 Connections(관리 화면)', async () => {
    wrap(bridgeWith([conn('a', 'prod')]))
    expect(screen.getByRole('button', { name: 'Connections' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Workspace' })).toBeTruthy()
    // Connections 탭 = 기존 관리 화면. 연결 관리(추가/편집)가 유지된다.
    await waitFor(() => expect(screen.getByText('prod')).toBeTruthy())
  })

  it('Workspace 탭에서 연결을 열면 뷰 서브탭이 있는 워크스페이스가 뜬다', async () => {
    const bridge = bridgeWith([conn('a', 'prod')])
    wrap(bridge)
    fireEvent.click(screen.getByRole('button', { name: 'Workspace' }))
    await waitFor(() => expect(screen.getByTestId('open-a')).toBeTruthy())
    fireEvent.click(screen.getByTestId('open-a'))
    await waitFor(() => {
      // eslint-disable-next-line @typescript-eslint/unbound-method -- vi.fn mock, no `this` binding involved
      const calls = vi.mocked(bridge.invoke).mock.calls.map((c) => c[0])
      expect(calls).toContain('connection:open')
    })
    // 서브탭(Query|Structure)이 나타난다.
    await waitFor(() => expect(screen.getByTestId('subtab-structure')).toBeTruthy())
    expect(screen.getByText(/Query — prod/)).toBeTruthy()
  })
})
