// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { ThemeProvider, darkTheme } from '@renderer/shared/theme'
import { ErView } from '@renderer/features/er'
import type { OperationGateway, OperationOutcome } from '@renderer/gateways/ports/OperationGateway'

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ width: 800, height: 400, top: 0, left: 0, right: 800, bottom: 400, x: 0, y: 0, toJSON() {} }),
  })
})

function outcome(op: string, table?: string): OperationOutcome {
  switch (op) {
    case 'listTables':
      return {
        ok: true,
        payload: {
          kind: 'tables',
          tables: [
            { schema: 'public', name: 'orders', kind: 'table', estimatedRows: null },
            { schema: 'public', name: 'users', kind: 'table', estimatedRows: null },
          ],
        },
      }
    case 'describeTable':
      return {
        ok: true,
        payload: {
          kind: 'tableDetail',
          detail: {
            schema: 'public',
            name: table ?? '?',
            columns: [{ name: 'id', type: 'int8', nullable: false, defaultValue: null, primaryKeyOrdinal: 1 }],
          },
        },
      }
    default:
      return { ok: true, payload: { kind: 'foreignKeys', foreignKeys: [] } }
  }
}
function gateway(): OperationGateway {
  return {
    run: vi.fn((req: { operation: { op: string; table?: string } }) =>
      Promise.resolve(outcome(req.operation.op, req.operation.table)),
    ) as OperationGateway['run'],
    cancel: vi.fn().mockResolvedValue(undefined),
    recentAudit: vi.fn().mockResolvedValue([]),
    onStreamMessage: vi.fn(() => () => {}),
  }
}
function wrap(onOpen = vi.fn()) {
  render(
    <ThemeProvider theme={darkTheme}>
      <ErView gateway={gateway()} connectionId="c1" schema="public" onOpenTable={onOpen} />
    </ThemeProvider>,
  )
  return onOpen
}

describe('ErView', () => {
  it('문서가 확정한 스키마의 그래프 노드가 렌더된다', async () => {
    wrap()
    await waitFor(() => expect(screen.getByText('orders')).toBeTruthy())
    expect(screen.getByText('users')).toBeTruthy()
  })

  it('첫 페인트에 "테이블 없음"이 스치지 않는다', () => {
    // 로딩 상태를 effect에서야 세우면, effect가 돌기 전의 첫 렌더에서 노드는
    // 비어 있고 loading은 false다 — ErView는 그 조합을 빈 상태로 그리므로 ER
    // 문서를 열 때마다 "테이블 없음"이 번쩍인다.
    //
    // RTL의 render는 act로 감싸 effect까지 흘려 버려서 그 프레임을 볼 수 없다.
    // 서버 렌더는 effect를 아예 돌리지 않으므로 정확히 첫 페인트만 보여 준다.
    const html = renderToStaticMarkup(
      <ThemeProvider theme={darkTheme}>
        <ErView gateway={gateway()} connectionId="c1" schema="public" onOpenTable={vi.fn()} />
      </ThemeProvider>,
    )
    expect(html).not.toContain('테이블 없음')
    expect(html).toContain('불러오는 중')
  })

  it('노드 클릭 시 onOpenTable(schema, table)을 호출한다', async () => {
    const onOpen = wrap()
    await waitFor(() => expect(screen.getByText('orders')).toBeTruthy())
    fireEvent.click(screen.getByText('orders'))
    expect(onOpen).toHaveBeenCalledWith('public', 'orders')
  })
})
