// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ThemeProvider, darkTheme } from '@renderer/shared/theme'
import { StreamsView } from '@renderer/features/streams/StreamsView'
import type { OperationGateway, OperationOutcome } from '@renderer/gateways/ports/OperationGateway'
import type { StreamBatch } from '@shared/types/stream'

/** listTopics는 토픽 하나(orders)를, subscribe는 구독 id를 준다. push로 배치를 흘려보낼 수 있다. */
function gateway() {
  let listener: ((b: StreamBatch) => void) | null = null
  const run = vi.fn((req: { operation: { op: string } }): Promise<OperationOutcome> => {
    if (req.operation.op === 'listTopics') {
      return Promise.resolve({
        ok: true,
        payload: {
          kind: 'rows',
          rows: {
            requestId: 'r',
            columns: [{ name: 'topic', type: 'str' }],
            rows: [[{ t: 'str', v: 'orders' }]],
            page: { cursor: null, hasMore: false, rowCount: 1, bytes: 0 },
            meta: { durationMs: 0, truncatedRows: false, truncatedBytes: false, rowsAffected: null },
          },
        },
      })
    }
    if (req.operation.op === 'subscribe') {
      return Promise.resolve({ ok: true, payload: { kind: 'streamAck', subscriptionId: 'sub-1' } })
    }
    return Promise.resolve({ ok: true, payload: { kind: 'streamAck', subscriptionId: null } })
  }) as OperationGateway['run']

  const gw: OperationGateway = {
    run,
    cancel: vi.fn().mockResolvedValue(undefined),
    recentAudit: vi.fn().mockResolvedValue([]),
    onStreamMessage: vi.fn((_id: string, l: (b: StreamBatch) => void) => {
      listener = l
      return () => {}
    }),
  }

  return { gw, push: (b: StreamBatch) => listener?.(b) }
}

function wrap(ui: React.ReactElement) {
  return render(<ThemeProvider theme={darkTheme}>{ui}</ThemeProvider>)
}

describe('StreamsView', () => {
  it('토픽을 보여주고, 선택→Start→push 메시지가 렌더된다', async () => {
    const { gw, push } = gateway()
    wrap(<StreamsView gateway={gw} connectionId="c1" />)

    await waitFor(() => expect(screen.getByText('orders')).toBeTruthy())
    fireEvent.click(screen.getByText('orders'))
    fireEvent.click(screen.getByRole('button', { name: 'Start' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy())

    act(() => {
      push({ columns: [{ name: 'value', type: 'str' }], rows: [[{ t: 'str', v: 'hello-msg' }]], droppedSince: 0 })
    })
    await waitFor(() => expect(screen.getByText(/hello-msg/)).toBeTruthy())
  })

  it('토픽 선택 전엔 안내 문구를 보여준다', async () => {
    const { gw } = gateway()
    wrap(<StreamsView gateway={gw} connectionId="c1" />)
    await waitFor(() => expect(screen.getByText('orders')).toBeTruthy())
    expect(screen.getByText('토픽을 선택하세요.')).toBeTruthy()
  })

  it('dropped 메시지가 있으면 dropped 카운트를 보여준다', async () => {
    const { gw, push } = gateway()
    wrap(<StreamsView gateway={gw} connectionId="c1" />)

    await waitFor(() => expect(screen.getByText('orders')).toBeTruthy())
    fireEvent.click(screen.getByText('orders'))
    fireEvent.click(screen.getByRole('button', { name: 'Start' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy())

    act(() => {
      push({ columns: [], rows: [], droppedSince: 3 })
    })
    await waitFor(() => expect(screen.getByText('3 dropped')).toBeTruthy())
  })
})
