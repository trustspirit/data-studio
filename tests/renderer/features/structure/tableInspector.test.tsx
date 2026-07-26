// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ThemeProvider, darkTheme } from '@renderer/shared/theme'
import { TableInspector } from '@renderer/features/structure/ui/TableInspector'
import type { OperationGateway } from '@renderer/gateways/ports/OperationGateway'
import type { ColumnInfo, IndexInfo } from '@shared/types/schema'

function gateway(): OperationGateway {
  return {
    run: vi.fn((req: { operation: { op?: string } }) => {
      const op = req.operation.op
      if (op === 'describeTable')
        return Promise.resolve({
          ok: true,
          payload: {
            kind: 'tableDetail',
            detail: {
              schema: 'public',
              name: 'orders',
              columns: [{ name: 'id', type: 'int8', nullable: false, defaultValue: null, primaryKeyOrdinal: 1 }],
            },
          },
        })
      if (op === 'listIndexes')
        return Promise.resolve({
          ok: true,
          payload: { kind: 'indexes', indexes: [{ name: 'orders_pkey', columns: ['id'], unique: true, primary: true }] },
        })
      if (op === 'listForeignKeys')
        return Promise.resolve({ ok: true, payload: { kind: 'foreignKeys', foreignKeys: [] } })
      return Promise.resolve({ ok: true, payload: { kind: 'foreignKeys', foreignKeys: [] } })
    }),
    cancel: vi.fn(() => Promise.resolve()),
  } as unknown as OperationGateway
}

function renderInspector(extra: React.ComponentProps<typeof TableInspector>['extraSections'] = []) {
  render(
    <ThemeProvider theme={darkTheme}>
      <TableInspector
        gateway={gateway()}
        connectionId="c1"
        selection={{ schema: 'public', table: 'orders' }}
        reloadToken={0}
        extraSections={extra}
      />
    </ThemeProvider>,
  )
}

describe('TableInspector', () => {
  it('컬럼·인덱스·외래키 섹션을 그린다', () => {
    renderInspector()
    expect(screen.getByTestId('inspector-section-columns')).toBeTruthy()
    expect(screen.getByTestId('inspector-section-indexes')).toBeTruthy()
    expect(screen.getByTestId('inspector-section-foreignKeys')).toBeTruthy()
  })

  it('컬럼 섹션은 처음부터 펼쳐져 있다 — 테이블을 열면 가장 먼저 보고 싶은 것이다', async () => {
    renderInspector()
    await waitFor(() => expect(screen.getByTestId('inspector-body-columns').textContent).toContain('id'))
  })

  it('넘겨받은 추가 섹션을 뒤에 붙인다', () => {
    renderInspector([{ id: 'ai', title: 'AI', content: <div>대화</div>, grow: true }])
    expect(screen.getByTestId('inspector-section-ai')).toBeTruthy()
  })

  it('인덱스 섹션을 펼치면 인덱스가 보인다', async () => {
    renderInspector()
    fireEvent.click(screen.getByTestId('inspector-section-indexes'))
    await waitFor(() => expect(screen.getByTestId('inspector-body-indexes').textContent).toContain('orders_pkey'))
  })

  it('부모가 안정된 콜백을 넘기면, 구조가 안 바뀐 리렌더에서는 다시 호출하지 않는다', async () => {
    // onStructureLoaded는 useEffect의 의존성 배열에 콜백 자체가 들어간다.
    // 부모가 매 렌더마다 새 화살표 함수를 넘기면 그 효과가 매번 재실행된다 —
    // 부모가 그 응답으로 상태를 바꾸면 무한 렌더 루프가 된다.
    // 여기서는 부모가 "안정된" 콜백(참조가 바뀌지 않는 함수)을 넘겼을 때,
    // 구조 데이터가 안 바뀐 리렌더에서는 추가로 호출되지 않는지를 고정한다.
    const onStructureLoaded =
      vi.fn<(structure: { readonly columns: readonly ColumnInfo[]; readonly indexes: readonly IndexInfo[] }) => void>()
    const gw = gateway()

    const { rerender } = render(
      <ThemeProvider theme={darkTheme}>
        <TableInspector
          gateway={gw}
          connectionId="c1"
          selection={{ schema: 'public', table: 'orders' }}
          reloadToken={0}
          extraSections={[]}
          onStructureLoaded={onStructureLoaded}
        />
      </ThemeProvider>,
    )

    // 로딩 완료(빈 배열 -> 실제 데이터) 전까지 최대 두 번(초기 마운트 + 로드 완료) 호출된다.
    await waitFor(() => expect(screen.getByTestId('inspector-body-columns').textContent).toContain('id'))

    // 호출 횟수뿐 아니라, 실제로 로드된 구조(빈 배열이 아니라 id 컬럼 포함)가
    // 콜백에 전달됐는지도 확인한다 — 효과가 mount 시 빈 초기값만 한 번 흘려보내고
    // 데이터가 도착했을 때 다시 실행되지 않는 회귀는 "호출은 됐다"만으로는 못 잡는다.
    const loaded = onStructureLoaded.mock.calls.at(-1)?.[0]
    expect(loaded?.columns.some((c) => c.name === 'id')).toBe(true)
    const callsAfterLoad = onStructureLoaded.mock.calls.length
    expect(callsAfterLoad).toBeGreaterThan(0)

    // 부모가 안정된 콜백을 그대로 넘긴 채 여러 번 리렌더해도, 구조 데이터가
    // 안 바뀌었으니 추가 호출이 없어야 한다.
    for (let i = 0; i < 5; i += 1) {
      rerender(
        <ThemeProvider theme={darkTheme}>
          <TableInspector
            gateway={gw}
            connectionId="c1"
            selection={{ schema: 'public', table: 'orders' }}
            reloadToken={0}
            extraSections={[]}
            onStructureLoaded={onStructureLoaded}
          />
        </ThemeProvider>,
      )
    }

    expect(onStructureLoaded.mock.calls.length).toBe(callsAfterLoad)
  })

  it('컬럼 이름 변경 콜백을 ColumnsTable에 전달한다', async () => {
    const onRenameColumn = vi.fn()
    render(
      <ThemeProvider theme={darkTheme}>
        <TableInspector
          gateway={gateway()}
          connectionId="c1"
          selection={{ schema: 'public', table: 'orders' }}
          reloadToken={0}
          extraSections={[]}
          onRenameColumn={onRenameColumn}
        />
      </ThemeProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('col-rename-id')).toBeTruthy())
    fireEvent.click(screen.getByTestId('col-rename-id'))
    expect(onRenameColumn).toHaveBeenCalledWith('id')
  })

  it('컬럼 삭제 콜백을 ColumnsTable에 전달한다', async () => {
    const onDropColumn = vi.fn()
    render(
      <ThemeProvider theme={darkTheme}>
        <TableInspector
          gateway={gateway()}
          connectionId="c1"
          selection={{ schema: 'public', table: 'orders' }}
          reloadToken={0}
          extraSections={[]}
          onDropColumn={onDropColumn}
        />
      </ThemeProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('col-drop-id')).toBeTruthy())
    fireEvent.click(screen.getByTestId('col-drop-id'))
    expect(onDropColumn).toHaveBeenCalledWith('id')
  })

  it('인덱스 삭제 콜백을 IndexList에 전달한다', async () => {
    const onDropIndex = vi.fn()
    render(
      <ThemeProvider theme={darkTheme}>
        <TableInspector
          gateway={gateway()}
          connectionId="c1"
          selection={{ schema: 'public', table: 'orders' }}
          reloadToken={0}
          extraSections={[]}
          onDropIndex={onDropIndex}
        />
      </ThemeProvider>,
    )
    fireEvent.click(screen.getByTestId('inspector-section-indexes'))
    await waitFor(() => expect(screen.getByTestId('index-drop-orders_pkey')).toBeTruthy())
    fireEvent.click(screen.getByTestId('index-drop-orders_pkey'))
    expect(onDropIndex).toHaveBeenCalledWith('orders_pkey')
  })
})
