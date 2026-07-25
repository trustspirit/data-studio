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
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, value: 800 })
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: 400 })
})

function conn(id: string, name: string) {
  return { id, name, engine: 'postgres', host: 'h', port: 5432, database: 'd', username: 'u', tlsMode: 'disable', aiReadOnlyUsername: null, maskedColumnPatterns: [] }
}

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
      if (channel === 'connection:close') return Promise.resolve({ ok: true, value: null })
      if (channel === 'connection:open')
        return Promise.resolve({ ok: true, value: { opened: true, capabilities: ['sql'] } })
      if (channel === 'secrets:status') return Promise.resolve({ ok: true, value: { persistent: true } })
      if (channel === 'secrets:has') return Promise.resolve({ ok: true, value: { exists: false } })
      if (channel === 'secrets:set') return Promise.resolve({ ok: true, value: null })
      if (channel === 'dialog:openFile') return Promise.resolve({ ok: true, value: '/tmp/test.db' })
      return Promise.resolve({ ok: false, code: 'internal_error' })
    }),
    on: () => () => {},
  }
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

describe('ConnectionSettingsPane', () => {
  it('사이드바의 +가 메인에 새 연결 폼을 연다', async () => {
    wrap(bridgeWith([]))
    fireEvent.click(screen.getByRole('button', { name: '새 연결' }))
    await waitFor(() => expect(screen.getByTestId('connection-settings')).toBeTruthy())
    expect(screen.getByLabelText('Name')).toBeTruthy()
  })

  it('행의 설정 버튼이 그 연결의 설정을 메인에 띄운다', async () => {
    wrap(bridgeWith([conn('a', 'prod')]))
    await waitFor(() => expect(screen.getByTestId('more-a')).toBeTruthy())
    fireEvent.click(screen.getByTestId('more-a'))
    fireEvent.click(screen.getByTestId('settings-a'))
    await waitFor(() => expect(screen.getByTestId('connection-settings')).toBeTruthy())
    expect(screen.getByLabelText<HTMLInputElement>('Name').value).toBe('prod')
  })

  it('검증 실패 시 저장하지 않고 오류를 표시한다', async () => {
    const bridge = bridgeWith([])
    wrap(bridge)
    fireEvent.click(screen.getByRole('button', { name: '새 연결' }))
    await waitFor(() => expect(screen.getByTestId('connection-settings')).toBeTruthy())
    fireEvent.click(screen.getByText('Save'))
    await waitFor(() => expect(screen.getByText(/Too small|required|expected/i)).toBeTruthy())
    // 검증을 통과 못 했으니 save 채널은 호출되지 않아야 한다.
    expect(channelsOf(bridge)).not.toContain('connection:save')
  })

  it('레코드를 전환하면 삭제 확인 상태가 초기화된다', async () => {
    wrap(bridgeWith([conn('a', 'A'), conn('b', 'B')]))
    await waitFor(() => expect(screen.getByTestId('more-a')).toBeTruthy())

    fireEvent.click(screen.getByTestId('more-a'))
    fireEvent.click(screen.getByTestId('settings-a'))
    await waitFor(() => expect(screen.getByText('Delete')).toBeTruthy())
    fireEvent.click(screen.getByText('Delete'))
    await waitFor(() => expect(screen.getByText(/Confirm delete/i)).toBeTruthy())

    // B로 전환하면 B의 폼은 확인 상태가 아니어야 한다.
    fireEvent.click(screen.getByTestId('more-b'))
    fireEvent.click(screen.getByTestId('settings-b'))
    await waitFor(() => expect(screen.queryByText(/Confirm delete/i)).toBeNull())
    expect(screen.getByText('Delete')).toBeTruthy()
  })

  it('비밀번호를 입력하고 저장하면 connection:save 후 secrets:set을 부른다', async () => {
    const bridge = bridgeWith([])
    wrap(bridge)
    fireEvent.click(screen.getByRole('button', { name: '새 연결' }))
    await waitFor(() => expect(screen.getByTestId('connection-settings')).toBeTruthy())
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'prod' } })
    fireEvent.change(screen.getByLabelText('Host'), { target: { value: 'db.local' } })
    fireEvent.change(screen.getByLabelText('Database'), { target: { value: 'shop' } })
    fireEvent.change(screen.getByLabelText('User'), { target: { value: 'admin' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } })
    fireEvent.click(screen.getByText('Save'))

    await waitFor(() => {
      const channels = channelsOf(bridge)
      expect(channels).toContain('connection:save')
      expect(channels).toContain('secrets:set')
    })
    // save가 secret보다 먼저여야 한다 (config가 있어야 소유 비밀이 의미를 갖는다).
    const order = channelsOf(bridge)
    expect(order.indexOf('connection:save')).toBeLessThan(order.indexOf('secrets:set'))
  })

  it('비밀번호가 비어 있으면 secrets:set을 부르지 않는다', async () => {
    const bridge = bridgeWith([])
    wrap(bridge)
    fireEvent.click(screen.getByRole('button', { name: '새 연결' }))
    await waitFor(() => expect(screen.getByTestId('connection-settings')).toBeTruthy())
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'prod' } })
    fireEvent.change(screen.getByLabelText('Host'), { target: { value: 'db.local' } })
    fireEvent.change(screen.getByLabelText('Database'), { target: { value: 'shop' } })
    fireEvent.change(screen.getByLabelText('User'), { target: { value: 'admin' } })
    fireEvent.click(screen.getByText('Save'))

    await waitFor(() => expect(channelsOf(bridge)).toContain('connection:save'))
    // 빈 비밀번호로 setSecret을 부르면 빈 값을 저장해 기존 비밀을 덮는다.
    expect(channelsOf(bridge)).not.toContain('secrets:set')
  })

  it('sqlite로 전환 후 Browse를 누르면 dialog:openFile 결과로 Database file을 채운다', async () => {
    const bridge = bridgeWith([])
    wrap(bridge)
    fireEvent.click(screen.getByRole('button', { name: '새 연결' }))
    await waitFor(() => expect(screen.getByTestId('connection-settings')).toBeTruthy())
    fireEvent.change(screen.getByLabelText('Engine'), { target: { value: 'sqlite' } })
    await waitFor(() => expect(screen.getByLabelText('Database file')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: /browse/i }))

    await waitFor(() =>
      expect(screen.getByLabelText<HTMLInputElement>('Database file').value).toBe('/tmp/test.db'),
    )
    expect(channelsOf(bridge)).toContain('dialog:openFile')
  })

  it('저장한 연결이 사이드바 트리에 나타난다', async () => {
    const bridge = bridgeWith([])
    wrap(bridge)
    fireEvent.click(screen.getByRole('button', { name: '새 연결' }))
    await waitFor(() => expect(screen.getByTestId('connection-settings')).toBeTruthy())
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'prod' } })
    fireEvent.change(screen.getByLabelText('Host'), { target: { value: 'db.local' } })
    fireEvent.change(screen.getByLabelText('Database'), { target: { value: 'shop' } })
    fireEvent.change(screen.getByLabelText('User'), { target: { value: 'admin' } })
    fireEvent.click(screen.getByText('Save'))

    await waitFor(() => expect(screen.getByText('prod')).toBeTruthy())
  })

  it('설정 패널은 열린 워크스페이스를 언마운트하지 않고 가린다', async () => {
    wrap(bridgeWith([conn('a', 'prod')]))
    await waitFor(() => expect(screen.getByTestId('connect-a')).toBeTruthy())
    fireEvent.click(screen.getByTestId('connect-a'))
    await waitFor(() => expect(screen.getByTestId('workspace-a')).toBeTruthy())

    fireEvent.click(screen.getByTestId('more-a'))
    fireEvent.click(screen.getByTestId('settings-a'))
    await waitFor(() => expect(screen.getByTestId('connection-settings')).toBeTruthy())
    // 폼을 잠깐 보는 동안 워크스페이스가 사라지면 작성 중이던 것이 날아간다.
    expect(screen.getByTestId('workspace-a')).toBeTruthy()

    fireEvent.click(screen.getByTestId('settings-close'))
    await waitFor(() => expect(screen.queryByTestId('connection-settings')).toBeNull())
    expect(screen.getByTestId('workspace-a')).toBeTruthy()
  })

  it('열린 연결을 삭제하면 connection:close가 connection:delete보다 먼저 나간다', async () => {
    const bridge = bridgeWith([conn('a', 'prod')])
    wrap(bridge)
    await waitFor(() => expect(screen.getByTestId('connect-a')).toBeTruthy())
    fireEvent.click(screen.getByTestId('connect-a'))
    await waitFor(() => expect(screen.getByTestId('workspace-a')).toBeTruthy())

    fireEvent.click(screen.getByTestId('more-a'))
    fireEvent.click(screen.getByTestId('settings-a'))
    await waitFor(() => expect(screen.getByText('Delete')).toBeTruthy())
    fireEvent.click(screen.getByText('Delete'))
    fireEvent.click(screen.getByText(/Confirm delete/i))

    await waitFor(() => expect(channelsOf(bridge)).toContain('connection:delete'))
    // 닫지 않고 지우면 풀이 남는다.
    const order = channelsOf(bridge)
    expect(order.indexOf('connection:close')).toBeGreaterThanOrEqual(0)
    expect(order.indexOf('connection:close')).toBeLessThan(order.indexOf('connection:delete'))
  })

  it('레일에 Connections 탭이 더 이상 없다', () => {
    wrap(bridgeWith([]))
    expect(screen.queryByRole('button', { name: 'Connections' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Workspace' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Audit' })).toBeTruthy()
  })
})
