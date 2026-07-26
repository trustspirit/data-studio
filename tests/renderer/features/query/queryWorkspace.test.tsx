// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider, darkTheme } from '@renderer/shared/theme'
import { QueryWorkspace } from '@renderer/features/query'
import type { OperationGateway } from '@renderer/gateways/ports/OperationGateway'
import type { ResultSet } from '@shared/types/resultSet'

/**
 * 실행 중인 Node에 실험적 전역 `localStorage`(Web Storage)가 있으면 vitest의 jsdom
 * 환경 연결보다 먼저 전역에 잡혀 있어서 jsdom의 실제 구현을 가린다 — 그 결과
 * `window.localStorage`가 이 Node 전역(파일 없이는 항상 undefined)으로 풀린다.
 * jsdom이 내부적으로 노출하는 실제 window로 위임해 우회한다.
 * (tests/renderer/shared/panelSize.test.ts와 같은 우회.)
 */
const jsdomGlobal = (globalThis as { jsdom?: { window: Window } }).jsdom
if (jsdomGlobal !== undefined) {
  Object.defineProperty(globalThis, 'localStorage', {
    get: () => jsdomGlobal.window.localStorage,
    configurable: true,
  })
}

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
// 패널 크기는 localStorage에 쌓인다 — 테스트마다 깨끗하게 시작하지 않으면
// 뒤 테스트가 앞 테스트가 남긴 값을 읽어 버린다.
beforeEach(() => {
  window.localStorage.clear()
  cleanup()
})
function rs(): ResultSet {
  return {
    requestId: 'r', columns: [{ name: 'id', type: '23' }], rows: [[{ t: 'int', v: 7 }]],
    page: { cursor: null, hasMore: false, rowCount: 1, bytes: 10 },
    meta: { durationMs: 1, truncatedRows: false, truncatedBytes: false, rowsAffected: null },
  }
}
function gateway(): OperationGateway {
  return {
    run: vi.fn(() => new Promise(() => {})),
    cancel: vi.fn().mockResolvedValue(undefined),
    recentAudit: vi.fn().mockResolvedValue([]),
    onStreamMessage: vi.fn(() => () => {}),
  } as unknown as OperationGateway
}
function wrap(node: React.ReactNode) {
  return render(<ThemeProvider theme={darkTheme}>{node}</ThemeProvider>)
}

describe('QueryWorkspace', () => {
  it('Run이 게이트웨이를 부르고 결과 그리드를 보인다', async () => {
    const gw: OperationGateway = {
      run: vi.fn().mockResolvedValue({ ok: true as const, payload: { kind: 'rows' as const, rows: rs() } }),
      cancel: vi.fn().mockResolvedValue(undefined),
      recentAudit: vi.fn().mockResolvedValue([]),
      onStreamMessage: vi.fn(() => () => {}),
    }
    wrap(<QueryWorkspace gateway={gw} connectionId="c1" />)
    fireEvent.click(screen.getByText('Run'))
    // eslint-disable-next-line @typescript-eslint/unbound-method -- vi.fn mock, no `this` binding involved
    await waitFor(() => expect(gw.run).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByText('7')).toBeTruthy())
  })

  it('오류를 배너로 보인다', async () => {
    const gw: OperationGateway = {
      run: vi.fn().mockResolvedValue({ ok: false as const, reason: 'syntax error' }),
      cancel: vi.fn().mockResolvedValue(undefined),
      recentAudit: vi.fn().mockResolvedValue([]),
      onStreamMessage: vi.fn(() => () => {}),
    }
    wrap(<QueryWorkspace gateway={gw} connectionId="c1" />)
    fireEvent.click(screen.getByText('Run'))
    await waitFor(() => expect(screen.getByText(/syntax error/)).toBeTruthy())
  })

  it('성공 후 실패하면 이전 그리드를 지우고 오류만 보인다', async () => {
    const gw: OperationGateway = {
      run: vi.fn()
        .mockResolvedValueOnce({ ok: true as const, payload: { kind: 'rows' as const, rows: rs() } })
        .mockResolvedValueOnce({ ok: false as const, reason: 'syntax error' }),
      cancel: vi.fn().mockResolvedValue(undefined),
      recentAudit: vi.fn().mockResolvedValue([]),
      onStreamMessage: vi.fn(() => () => {}),
    }
    wrap(<QueryWorkspace gateway={gw} connectionId="c1" />)
    fireEvent.click(screen.getByText('Run'))
    await waitFor(() => expect(screen.getByText('7')).toBeTruthy())
    expect(screen.getByText('id')).toBeTruthy()

    fireEvent.click(screen.getByText('Run'))
    await waitFor(() => expect(screen.getByText(/syntax error/)).toBeTruthy())
    expect(screen.queryByText('id')).toBeNull()
  })

  it('에디터와 결과 사이에 리사이즈 경계를 둔다', () => {
    wrap(<QueryWorkspace gateway={gateway()} connectionId="c1" engine="postgres" />)
    const sep = screen.getByTestId('split-editor')
    expect(sep.getAttribute('role')).toBe('separator')
    expect(sep.getAttribute('aria-orientation')).toBe('horizontal')
  })

  it('Run 버튼을 그린다', () => {
    wrap(<QueryWorkspace gateway={gateway()} connectionId="c1" engine="postgres" />)
    expect(screen.getByTestId('query-run')).toBeTruthy()
  })

  it('에디터 높이를 조절하면 localStorage에 저장되고, 다음에 열 때 그 값으로 되돌아온다', () => {
    wrap(<QueryWorkspace gateway={gateway()} connectionId="c1" />)
    const sep = screen.getByTestId('split-editor')
    expect(sep.getAttribute('aria-valuenow')).toBe(String(darkTheme.size.editorDefault))

    // 키보드로 아래쪽 화살표 한 번 — 고정 쪽(에디터)이 STEP(16px)만큼 커진다.
    fireEvent.keyDown(sep, { key: 'ArrowDown' })
    const grown = darkTheme.size.editorDefault + 16
    expect(sep.getAttribute('aria-valuenow')).toBe(String(grown))
    expect(window.localStorage.getItem('datacon.panel.editor')).toBe(String(grown))

    // 재마운트 — 새 인스턴스가 저장된 값을 읽어 그 크기로 시작해야 한다.
    cleanup()
    wrap(<QueryWorkspace gateway={gateway()} connectionId="c1" />)
    const sep2 = screen.getByTestId('split-editor')
    expect(sep2.getAttribute('aria-valuenow')).toBe(String(grown))
  })

  it('저장된 값이 현재 min/max 밖이면 읽어올 때 안쪽으로 가둔다', () => {
    window.localStorage.setItem('datacon.panel.editor', String(darkTheme.size.editorMax + 500))
    wrap(<QueryWorkspace gateway={gateway()} connectionId="c1" />)
    const sep = screen.getByTestId('split-editor')
    expect(sep.getAttribute('aria-valuenow')).toBe(String(darkTheme.size.editorMax))
  })
})
