// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider, darkTheme } from '@renderer/shared/theme'
import { GatewayProvider } from '@renderer/app/GatewayProvider'
import { buildGateways } from '@renderer/app/container'
import { AppShell } from '@renderer/app/AppShell'
import type { DataconBridge } from '@renderer/gateways/ipc/ipcInvoke'

/**
 * 실행 중인 Node에 실험적 전역 `localStorage`가 있으면 vitest의 jsdom 환경보다
 * 먼저 잡혀 있어서 jsdom의 실제 구현을 가린다. jsdom window로 위임해 우회한다.
 * (tests/renderer/features/query/queryWorkspace.test.tsx와 같은 우회.)
 */
const jsdomGlobal = (globalThis as { jsdom?: { window: Window } }).jsdom
if (jsdomGlobal !== undefined) {
  Object.defineProperty(globalThis, 'localStorage', {
    get: () => jsdomGlobal.window.localStorage,
    configurable: true,
  })
}

// 패널 크기는 localStorage에 쌓인다 — 테스트마다 깨끗하게 시작하지 않으면
// 뒤 테스트가 앞 테스트가 남긴 값을 읽어 버린다.
beforeEach(() => {
  window.localStorage.clear()
  cleanup()
})

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
      // Audit 레일 탭이 읽는 채널. 기본값 null을 그대로 주면 AuditView가 렌더에서 죽는다.
      if (channel === 'audit:recent') return Promise.resolve({ ok: true, value: [] })
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
  it('연결 닫기가 실패하면 저장된 연결을 삭제하지 않는다', async () => {
    const base = bridgeWith([conn('a', 'prod')])
    const bridge: DataconBridge = {
      ...base,
      invoke: vi.fn((channel: Parameters<DataconBridge['invoke']>[0], input: unknown) => channel === 'connection:close'
        ? Promise.reject(new Error('close failed'))
        : base.invoke(channel, input)),
    }
    wrap(bridge)
    await waitFor(() => expect(screen.getByTestId('connect-a')).toBeTruthy())
    fireEvent.click(screen.getByTestId('connect-a'))
    await waitFor(() => expect(screen.getByTestId('workspace-a')).toBeTruthy())
    fireEvent.click(screen.getByTestId('more-a'))
    fireEvent.click(screen.getByTestId('settings-a'))
    fireEvent.click(await screen.findByText('Delete'))
    fireEvent.click(screen.getByText(/Confirm delete/i))
    await waitFor(() => expect(screen.getByTestId('row-error-a').textContent).toContain('close failed'))
    expect(channelsOf(bridge)).not.toContain('connection:delete')
  })

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

  it('연결을 닫았다 다시 열면 옛 문서가 따라오지 않는다', async () => {
    // 닫힌 연결의 탭 세트가 남으면 다시 열었을 때 사라진 테이블과 옛 초안을
    // 그대로 들고 온다. 예전엔 useOpenConnections가 selection을 비우며 지키던
    // 불변식이고, 지금은 셸이 shell.open에서 빠진 연결의 탭을 버리며 지킨다.
    const bridge = bridgeWith([conn('a', 'prod')])
    wrap(bridge)
    await goToWorkspace(bridge)
    await waitFor(() => expect(screen.getByTestId('connect-a')).toBeTruthy())
    fireEvent.click(screen.getByTestId('connect-a'))
    await waitFor(() => expect(screen.getByTestId('workspace-a')).toBeTruthy())

    fireEvent.click(within(screen.getByTestId('workspace-a')).getByTestId('doctab-new-query'))
    await waitFor(() => expect(screen.getByTestId('doctab-query:1')).toBeTruthy())

    fireEvent.click(screen.getByTestId('more-a'))
    fireEvent.click(screen.getByTestId('close-a'))
    await waitFor(() => expect(screen.queryByTestId('workspace-a')).toBeNull())

    fireEvent.click(screen.getByTestId('connect-a'))
    await waitFor(() => expect(screen.getByTestId('workspace-a')).toBeTruthy())

    expect(screen.queryByTestId('doctab-query:1')).toBeNull()
    expect(within(screen.getByTestId('workspace-a')).getByTestId('document-empty')).toBeTruthy()
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

  it('사이드바 폭을 조절하면 localStorage에 저장되고, 다음에 열 때 그 값으로 되돌아온다', async () => {
    // 위 테스트는 SplitPane이 자기 값을 올린다는 것만 본다(그건 splitPane.test.tsx가
    // 이미 지킨다). 셸이 그 값을 **저장하고 다시 읽는지**는 별개의 성질이라
    // 따로 못박는다 — queryWorkspace의 'editor' 키 테스트와 같은 모양.
    const bridge = bridgeWith([conn('a', 'prod')])
    wrap(bridge)
    await goToWorkspace(bridge)
    const sep = screen.getByTestId('split-sidebar')
    expect(sep.getAttribute('aria-valuenow')).toBe(String(darkTheme.size.sidebarDefault))

    fireEvent.keyDown(sep, { key: 'ArrowRight' })
    const grown = darkTheme.size.sidebarDefault + 16
    expect(sep.getAttribute('aria-valuenow')).toBe(String(grown))
    expect(window.localStorage.getItem('datacon.panel.sidebar')).toBe(String(grown))

    // 재마운트 — 새 셸이 저장된 값을 읽어 그 폭으로 시작해야 한다.
    cleanup()
    const bridge2 = bridgeWith([conn('a', 'prod')])
    wrap(bridge2)
    await goToWorkspace(bridge2)
    expect(screen.getByTestId('split-sidebar').getAttribute('aria-valuenow')).toBe(String(grown))
  })

  it('Audit을 보는 동안에는 탭 단축키가 워크스페이스에 닿지 않는다', async () => {
    // 워크스페이스는 Audit이 앞에 와도 언마운트되지 않고 display:none 레이어로
    // 물러난다 — window에 걸린 탭 단축키 리스너는 그대로 살아 있다. 셸이
    // 가시성을 내려 주지 않으면, Audit을 보는 사용자의 Cmd+W가 보이지도 않는
    // 문서를 조용히 닫는다.
    const bridge = bridgeWith([conn('a', 'prod')])
    wrap(bridge)
    await goToWorkspace(bridge)
    await waitFor(() => expect(screen.getByTestId('connect-a')).toBeTruthy())
    fireEvent.click(screen.getByTestId('connect-a'))
    await waitFor(() => expect(screen.getByTestId('workspace-a')).toBeTruthy())
    fireEvent.click(within(screen.getByTestId('workspace-a')).getByTestId('doctab-new-query'))
    await waitFor(() => expect(screen.getByTestId('doctab-query:1')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'Audit' }))
    await waitFor(() => expect(screen.getByTestId('workspace-a').closest('[hidden]')).toBeTruthy())

    fireEvent.keyDown(window, { key: 'w', metaKey: true })

    // 워크스페이스로 돌아오면 문서가 그대로 있어야 한다.
    fireEvent.click(screen.getByRole('button', { name: 'Workspace' }))
    await waitFor(() => expect(screen.getByTestId('workspace-a').closest('[hidden]')).toBeNull())
    expect(screen.getByTestId('doctab-query:1')).toBeTruthy()
  })

  it('연결이 없으면 트리와 메인이 모두 추가를 안내한다', async () => {
    const bridge = bridgeWith([])
    wrap(bridge)
    await goToWorkspace(bridge)
    expect(within(screen.getByTestId('connection-tree')).getByText(/\+로 추가하세요/)).toBeTruthy()
    expect(screen.getByRole('region', { name: '시작하기' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '새 연결 추가' }))
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Name' })).toBeTruthy())
  })
})
