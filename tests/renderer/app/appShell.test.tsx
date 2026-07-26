// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
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
    on: () => () => {},
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
function channelsOf(bridge: DataconBridge): string[] {
  // eslint-disable-next-line @typescript-eslint/unbound-method -- vi.fn mock, no `this` binding involved
  return vi.mocked(bridge.invoke).mock.calls.map((c) => c[0])
}
async function goToWorkspace(bridge: DataconBridge): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: 'Workspace' }))
  await waitFor(() => expect(screen.getByTestId('connection-tree')).toBeTruthy())
  await waitFor(() => expect(channelsOf(bridge)).toContain('connection:list'))
}

describe('AppShell', () => {
  it('워크스페이스 사이드바가 저장된 연결을 모두 트리에 보여 준다', async () => {
    const bridge = bridgeWith([conn('a', 'prod'), conn('b', 'staging')])
    wrap(bridge)
    await goToWorkspace(bridge)
    await waitFor(() => expect(screen.getByTestId('conn-a')).toBeTruthy())
    expect(screen.getByTestId('conn-b')).toBeTruthy()
    expect(within(screen.getByTestId('connection-tree')).getByText('prod')).toBeTruthy()
    expect(within(screen.getByTestId('connection-tree')).getByText('staging')).toBeTruthy()
  })

  it('미개통 연결의 행을 누르면 접속하지 않고 메인에 접속을 권한다', async () => {
    const bridge = bridgeWith([conn('a', 'prod')])
    wrap(bridge)
    await goToWorkspace(bridge)
    await waitFor(() => expect(screen.getByTestId('conn-a')).toBeTruthy())

    fireEvent.click(screen.getByTestId('conn-a'))

    // 사이드바에서 스치듯 누른 클릭이 프로덕션 접속이 되면 안 된다.
    expect(channelsOf(bridge)).not.toContain('connection:open')
    expect(screen.queryByTestId('workspace-a')).toBeNull()
    // 그래도 클릭이 아무 데도 닿지 않으면 막다른 길이다 — 무엇을 골랐는지
    // 보여 주고 접속 버튼을 준다.
    const invite = screen.getByTestId('invite-a')
    expect(within(invite).getByText('prod')).toBeTruthy()
    expect(screen.getByTestId('invite-connect-a')).toBeTruthy()
  })

  it('메인의 접속 버튼이 실제로 접속하고 초대 화면을 대체한다', async () => {
    const bridge = bridgeWith([conn('a', 'prod')])
    wrap(bridge)
    await goToWorkspace(bridge)
    await waitFor(() => expect(screen.getByTestId('conn-a')).toBeTruthy())
    fireEvent.click(screen.getByTestId('conn-a'))

    fireEvent.click(screen.getByTestId('invite-connect-a'))

    await waitFor(() => expect(screen.getByTestId('workspace-a')).toBeTruthy())
    // 접속되면 초대는 사라진다.
    expect(screen.queryByTestId('invite-a')).toBeNull()
  })

  it('접속에 실패하면 초대 화면이 사유를 안고 남는다', async () => {
    const bridge: DataconBridge = {
      invoke: vi.fn((channel: string) => {
        if (channel === 'connection:list') return Promise.resolve({ ok: true, value: [conn('a', 'prod')] })
        if (channel === 'secrets:status') return Promise.resolve({ ok: true, value: { persistent: true } })
        if (channel === 'connection:open')
          return Promise.resolve({ ok: true, value: { opened: false, reason: 'password required' } })
        return Promise.resolve({ ok: true, value: null })
      }),
      on: () => () => {},
    }
    wrap(bridge)
    await goToWorkspace(bridge)
    await waitFor(() => expect(screen.getByTestId('conn-a')).toBeTruthy())
    fireEvent.click(screen.getByTestId('conn-a'))

    fireEvent.click(screen.getByTestId('invite-connect-a'))

    await waitFor(() =>
      expect(within(screen.getByTestId('invite-a')).getByText(/password required/)).toBeTruthy(),
    )
    expect(screen.getByTestId('invite-connect-a').textContent).toBe('다시 연결')
  })

  it('연결 버튼을 눌러야 실제로 접속하고 워크스페이스가 뜬다', async () => {
    const bridge = bridgeWith([conn('a', 'prod')])
    wrap(bridge)
    await goToWorkspace(bridge)
    await waitFor(() => expect(screen.getByTestId('connect-a')).toBeTruthy())

    fireEvent.click(screen.getByTestId('connect-a'))

    await waitFor(() => expect(channelsOf(bridge)).toContain('connection:open'))
    await waitFor(() => expect(screen.getByTestId('workspace-a')).toBeTruthy())
    // SQL 연결은 자동으로 열리는 문서가 없다 — 탭 줄과 빈 안내가 함께 뜬다.
    const pane = screen.getByTestId('workspace-a')
    expect(within(pane).getByTestId('doctab-new-query')).toBeTruthy()
    expect(within(pane).getByTestId('document-empty')).toBeTruthy()
  })

  it('두 연결을 열고 행 클릭으로 전환할 수 있다', async () => {
    const bridge = bridgeWith([conn('a', 'prod'), conn('b', 'staging')])
    wrap(bridge)
    await goToWorkspace(bridge)
    await waitFor(() => expect(screen.getByTestId('connect-a')).toBeTruthy())

    fireEvent.click(screen.getByTestId('connect-a'))
    await waitFor(() => expect(screen.getByTestId('workspace-a')).toBeTruthy())
    fireEvent.click(screen.getByTestId('connect-b'))
    await waitFor(() => expect(screen.getByTestId('workspace-b')).toBeTruthy())

    // 나중에 연 쪽이 활성이고, 먼저 연 쪽은 마운트된 채 숨는다.
    expect(screen.getByTestId('workspace-b').hasAttribute('hidden')).toBe(false)
    expect(screen.getByTestId('workspace-a').hasAttribute('hidden')).toBe(true)

    fireEvent.click(screen.getByTestId('conn-a'))
    await waitFor(() => expect(screen.getByTestId('workspace-a').hasAttribute('hidden')).toBe(false))
    expect(screen.getByTestId('workspace-b').hasAttribute('hidden')).toBe(true)
  })

  it('열린 연결의 닫기가 connection:close를 부르고 워크스페이스를 언마운트한다', async () => {
    const bridge = bridgeWith([conn('a', 'prod')])
    wrap(bridge)
    await goToWorkspace(bridge)
    await waitFor(() => expect(screen.getByTestId('connect-a')).toBeTruthy())
    fireEvent.click(screen.getByTestId('connect-a'))
    await waitFor(() => expect(screen.getByTestId('workspace-a')).toBeTruthy())

    fireEvent.click(screen.getByTestId('more-a'))
    fireEvent.click(screen.getByTestId('close-a'))

    await waitFor(() => expect(channelsOf(bridge)).toContain('connection:close'))
    await waitFor(() => expect(screen.queryByTestId('workspace-a')).toBeNull())
    // 다시 접속할 수 있는 상태로 돌아간다.
    expect(screen.getByTestId('connect-a')).toBeTruthy()
  })

  it('열기에 실패하면 행 아래에 사유가 뜨고 재시도할 수 있다', async () => {
    const bridge: DataconBridge = {
      invoke: vi.fn((channel: string) => {
        if (channel === 'connection:list') return Promise.resolve({ ok: true, value: [conn('a', 'prod')] })
        if (channel === 'secrets:status') return Promise.resolve({ ok: true, value: { persistent: true } })
        if (channel === 'connection:open')
          return Promise.resolve({ ok: true, value: { opened: false, reason: 'password required' } })
        return Promise.resolve({ ok: true, value: null })
      }),
      on: () => () => {},
    }
    wrap(bridge)
    await goToWorkspace(bridge)
    await waitFor(() => expect(screen.getByTestId('connect-a')).toBeTruthy())

    fireEvent.click(screen.getByTestId('connect-a'))

    await waitFor(() => expect(screen.getByTestId('row-error-a').textContent).toContain('password required'))
    expect(screen.getByTestId('connect-a').textContent).toBe('재시도')
  })

  it('접속하면 새 쿼리 버튼으로 쿼리 문서를 열 수 있다', async () => {
    const bridge = bridgeWith([conn('a', 'prod')])
    wrap(bridge)
    await goToWorkspace(bridge)
    await waitFor(() => expect(screen.getByTestId('connect-a')).toBeTruthy())
    fireEvent.click(screen.getByTestId('connect-a'))
    await waitFor(() => expect(screen.getByTestId('workspace-a')).toBeTruthy())

    fireEvent.click(within(screen.getByTestId('workspace-a')).getByTestId('doctab-new-query'))

    await waitFor(() => expect(screen.getByTestId('doctab-query:1')).toBeTruthy())
    expect(screen.getByTestId('docpane-query:1')).toBeTruthy()
    // 문서가 생겼으니 빈 안내는 사라진다.
    expect(screen.queryByTestId('document-empty')).toBeNull()
  })

  it('비-SQL 엔진은 접속하자마자 단일 문서를 열고 탭 줄을 감춘다', async () => {
    // Redis는 열 수 있는 문서가 Keys 하나뿐이다 — 탭 줄은 크롬 낭비고,
    // 자동으로 열어 주지 않으면 접속해도 빈 화면만 남는다.
    const bridge: DataconBridge = {
      invoke: vi.fn((channel: string) => {
        if (channel === 'connection:list') return Promise.resolve({ ok: true, value: [conn('a', 'cache')] })
        if (channel === 'secrets:status') return Promise.resolve({ ok: true, value: { persistent: true } })
        if (channel === 'connection:open')
          return Promise.resolve({ ok: true, value: { opened: true, capabilities: ['keyvalue'] } })
        return Promise.resolve({ ok: true, value: null })
      }),
      on: () => () => {},
    }
    wrap(bridge)
    await goToWorkspace(bridge)
    await waitFor(() => expect(screen.getByTestId('connect-a')).toBeTruthy())

    fireEvent.click(screen.getByTestId('connect-a'))

    await waitFor(() => expect(screen.getByTestId('docpane-keys')).toBeTruthy())
    expect(screen.queryByRole('tablist')).toBeNull()
  })

  it('사이드바 폭을 구분자로 조절한다', async () => {
    const bridge = bridgeWith([conn('a', 'prod')])
    wrap(bridge)
    await goToWorkspace(bridge)
    const gutter = screen.getByTestId('split-sidebar')
    const before = Number(gutter.getAttribute('aria-valuenow'))
    fireEvent.keyDown(gutter, { key: 'ArrowRight' })
    expect(Number(screen.getByTestId('split-sidebar').getAttribute('aria-valuenow'))).toBeGreaterThan(before)
  })

  it('연결이 없으면 트리와 메인이 모두 추가를 안내한다', async () => {
    const bridge = bridgeWith([])
    wrap(bridge)
    await goToWorkspace(bridge)
    expect(within(screen.getByTestId('connection-tree')).getByText(/\+로 추가하세요/)).toBeTruthy()
    expect(screen.getByText(/사이드바의 \+ 로 추가하세요/)).toBeTruthy()
  })
})
