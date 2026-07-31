// @vitest-environment jsdom
import { render, screen, fireEvent } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { ThemeProvider, darkTheme } from '@renderer/shared/theme'
import { DataGrid } from '@renderer/entities/result-set/ui/DataGrid'
import type { WireValue } from '@shared/types/wire'

// jsdom은 레이아웃을 하지 않으므로 가상화가 쓰는 크기를 목으로 준다.
// @tanstack/react-virtual(v3)는 뷰포트 측정에 getBoundingClientRect가 아니라
// offsetWidth/offsetHeight(getRect)를 쓴다 — 이걸 안 채우면 뷰포트가 0x0으로
// 측정되어 가상 항목이 0개가 되고, "전량 렌더 아님" 단언이 "아무것도 렌더 안 함"
// 이라는 잘못된 이유로 통과해버린다(오검증). clientHeight는 스크롤 핸들러 계산에 쓰인다.
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: function () {
      return { width: 800, height: 400, top: 0, left: 0, right: 800, bottom: 400, x: 0, y: 0, toJSON() {} }
    },
  })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, value: 400 })
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: 400 })
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, value: 800 })
})

const columns = [{ name: 'id', type: '23' }, { name: 'name', type: '25' }]
function rows(n: number): WireValue[][] {
  return Array.from({ length: n }, (_, i) => [{ t: 'int', v: i }, { t: 'str', v: `r${i}` }])
}
function wrap(node: React.ReactNode) {
  return render(<ThemeProvider theme={darkTheme}>{node}</ThemeProvider>)
}

describe('DataGrid', () => {
  it('열 헤더를 렌더한다', () => {
    wrap(<DataGrid columns={columns} rows={rows(3)} />)
    expect(screen.getByText('id')).toBeTruthy()
    expect(screen.getByText('name')).toBeTruthy()
  })

  it('행 높이가 density.rowHeight와 정확히 같고 셀의 세로 패딩은 0이다 — 가상화 간격과 시각 높이가 어긋나면 행이 겹친다', () => {
    const { container } = wrap(<DataGrid columns={columns} rows={rows(3)} />)
    const cell = container.querySelector('[data-cell]') as HTMLElement
    const row = cell.parentElement as HTMLElement
    // DataGrid의 ROW_HEIGHT는 가상화가 숫자를 요구해 별도 상수로 산다. 그 상수가
    // 토큰과 갈라지는 순간 가상 스크롤이 깨지므로, 리터럴이 아니라 토큰과 비교한다.
    expect(getComputedStyle(row).height).toBe(darkTheme.density.rowHeight)
    // Cell의 세로 패딩이 0이어야 한다 — density.rowPad의 세로 성분이 그리드에 닿지
    // 않는다는 증거. rowPad를 되살리면 여기서 반드시 깨진다.
    const cellStyle = getComputedStyle(cell)
    expect(cellStyle.paddingTop).toBe('0px')
    expect(cellStyle.paddingBottom).toBe('0px')
  })

  it('큰 행 집합에서 전량을 DOM에 만들지 않는다 (가상화)', () => {
    const { container } = wrap(<DataGrid columns={columns} rows={rows(5000)} />)
    // 셀에 data-cell 속성을 달아 렌더된 셀 수를 센다. 5000행 x 2열 = 10000셀이면 가상화 실패.
    // 목 뷰포트(400px, 행높이 36px, overscan 12)에서 실제로 렌더되는 행은 15~35개
    // 안팎이다(약 30~70셀). 500은 그 값의 여러 배 여유를 두면서도 전량 렌더(10000)의
    // 5%에 불과해, "가상화 제거 시 반드시 실패"하는 취지를 유지하면서 환경차 흔들림도
    // 흡수한다 — 2000처럼 총량의 20%를 허용하는 느슨한 값으로 취지를 희석하지 않는다.
    const cells = container.querySelectorAll('[data-cell]')
    expect(cells.length).toBeGreaterThan(0) // 완전 미렌더(뷰포트 측정 실패)도 가상화 실패로 취급
    expect(cells.length).toBeLessThan(500) // 뷰포트 근사치로 제한
  })

  it('바닥 근처 스크롤이 onLoadMore를 부른다', () => {
    const onLoadMore = vi.fn()
    const { container } = wrap(
      <DataGrid columns={columns} rows={rows(50)} hasMore={true} onLoadMore={onLoadMore} />,
    )
    const scroller = container.querySelector('[data-grid-scroll]') as HTMLElement
    // 스크롤을 바닥으로. jsdom은 scrollTop을 저장하므로 이벤트를 직접 쏜다.
    Object.defineProperty(scroller, 'scrollTop', { configurable: true, value: 100000 })
    Object.defineProperty(scroller, 'scrollHeight', { configurable: true, value: 100400 })
    fireEvent.scroll(scroller)
    expect(onLoadMore).toHaveBeenCalled()
  })

  it('onHeaderClick이 있으면 헤더 클릭 시 컬럼명을 준다', () => {
    const onHeaderClick = vi.fn()
    wrap(
      <DataGrid
        columns={[{ name: 'id', type: '23' }, { name: 'name', type: '25' }]}
        rows={[]}
        onHeaderClick={onHeaderClick}
      />,
    )
    fireEvent.click(screen.getByText('id'))
    expect(onHeaderClick).toHaveBeenCalledWith('id')
  })

  it('현재 sort 컬럼에 방향 표식을 보인다', () => {
    wrap(
      <DataGrid
        columns={[{ name: 'id', type: '23' }]}
        rows={[]}
        sort={{ column: 'id', direction: 'desc' }}
      />,
    )
    // 'id' 헤더 셀에 방향 표식(▼)이 포함된다.
    expect(screen.getByText(/id/).textContent).toMatch(/▼/)
  })

  it('editing이면 셀을 편집해 commit한다', () => {
    const onCommitCell = vi.fn()
    wrap(
      <DataGrid
        columns={[{ name: 'id', type: '23' }, { name: 'name', type: '25' }]}
        rows={[[{ t: 'int', v: 1 }, { t: 'str', v: 'a' }]]}
        editing={{
          onCommitCell,
          edits: new Map(),
          deletedRows: new Set(),
          onToggleDelete: vi.fn(),
          newRows: [],
          onCommitNewCell: vi.fn(),
          onSetNull: vi.fn(),
          onSetNewCellNull: vi.fn(),
        }}
      />,
    )
    // 'a' 셀을 더블클릭 → 인풋 → 값 입력 → Enter로 commit.
    fireEvent.doubleClick(screen.getByText('a'))
    const input = screen.getByDisplayValue('a')
    fireEvent.change(input, { target: { value: 'A' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onCommitCell).toHaveBeenCalledWith(0, 'name', 'A')
  })

  it('포커스된 편집 가능 셀에서 Enter를 누르면 편집기를 연다', () => {
    const { container } = wrap(
      <DataGrid
        columns={[{ name: 'name', type: '25' }]}
        rows={[[{ t: 'str', v: 'a' }]]}
        editing={editingProps()}
      />,
    )
    const cell = screen.getByText('a').closest('[data-cell]') as HTMLElement

    expect(cell.tabIndex).toBe(0)
    expect(cell.hasAttribute('data-editable')).toBe(true)
    expect(container.querySelector('[data-editable]')).toBe(cell)
    cell.focus()
    expect(document.activeElement).toBe(cell)
    fireEvent.keyDown(cell, { key: 'Enter' })

    expect(screen.getByDisplayValue('a')).toBeTruthy()
  })

  it('포커스된 편집 가능 셀에서 F2를 누르면 편집기를 연다', () => {
    wrap(
      <DataGrid
        columns={[{ name: 'name', type: '25' }]}
        rows={[[{ t: 'str', v: 'a' }]]}
        editing={editingProps()}
      />,
    )
    const cell = screen.getByText('a').closest('[data-cell]') as HTMLElement
    cell.focus()
    expect(document.activeElement).toBe(cell)
    fireEvent.keyDown(cell, { key: 'F2' })

    expect(screen.getByDisplayValue('a')).toBeTruthy()
  })

  it('editing 미전달이면 셀은 포커스·키보드 편집 불가(읽기 전용)', () => {
    wrap(<DataGrid columns={[{ name: 'name', type: '25' }]} rows={[[{ t: 'str', v: 'a' }]]} />)
    const cell = screen.getByText('a').closest('[data-cell]') as HTMLElement

    expect(cell.tabIndex).toBe(-1)
    expect(cell.hasAttribute('data-editable')).toBe(false)
    fireEvent.keyDown(cell, { key: 'Enter' })
    expect(screen.queryByDisplayValue('a')).toBeNull()
  })

  function editingProps(over: Partial<import('@renderer/entities/result-set/ui/DataGrid').EditingProps> = {}) {
    return {
      onCommitCell: vi.fn(),
      edits: new Map<number, ReadonlyMap<string, WireValue>>(),
      deletedRows: new Set<number>(),
      onToggleDelete: vi.fn(),
      newRows: [] as ReadonlyMap<string, WireValue>[],
      onCommitNewCell: vi.fn(),
      onSetNull: vi.fn(),
      onSetNewCellNull: vi.fn(),
      ...over,
    }
  }

  it('스테이징 새 행을 그리드 하단에 렌더한다', () => {
    const newRows = [new Map<string, WireValue>([['name', { t: 'str', v: 'draft' }]])]
    const ep = editingProps({ newRows })
    wrap(
      <DataGrid
        columns={[{ name: 'id', type: '23' }, { name: 'name', type: '25' }]}
        rows={[]}
        editing={ep}
      />,
    )
    // 새 행의 name 셀 인풋에 'draft'가 보인다.
    expect(screen.getByDisplayValue('draft')).toBeTruthy()
  })

  it('새 행 셀 입력이 onCommitNewCell을 부른다', () => {
    const onCommitNewCell = vi.fn()
    const newRows = [new Map<string, WireValue>()]
    wrap(
      <DataGrid
        columns={[{ name: 'id', type: '23' }]}
        rows={[]}
        editing={editingProps({ newRows, onCommitNewCell })}
      />,
    )
    fireEvent.change(screen.getByLabelText('새 행 0 id'), { target: { value: '7' } })
    expect(onCommitNewCell).toHaveBeenCalledWith(0, 'id', '7')
  })

  it('새 행 NULL 버튼이 onSetNewCellNull을 부른다', () => {
    const onSetNewCellNull = vi.fn()
    const newRows = [new Map<string, WireValue>()]
    wrap(
      <DataGrid
        columns={[{ name: 'id', type: '23' }]}
        rows={[]}
        editing={editingProps({ newRows, onSetNewCellNull })}
      />,
    )
    fireEvent.click(screen.getByLabelText('새 행 0 id NULL'))
    expect(onSetNewCellNull).toHaveBeenCalledWith(0, 'id')
  })

  it('기존 셀 편집 중 NULL 버튼이 onSetNull을 부른다', () => {
    const onSetNull = vi.fn()
    wrap(
      <DataGrid
        columns={[{ name: 'name', type: '25' }]}
        rows={[[{ t: 'str', v: 'a' }]]}
        editing={editingProps({ onSetNull })}
      />,
    )
    fireEvent.doubleClick(screen.getByText('a'))
    fireEvent.click(screen.getByLabelText('행 0 name NULL'))
    expect(onSetNull).toHaveBeenCalledWith(0, 'name')
  })

  function staged(rowIndex: number, column: string, v: string) {
    return new Map<number, ReadonlyMap<string, WireValue>>([
      [rowIndex, new Map<string, WireValue>([[column, { t: 'str', v }]])],
    ])
  }

  it('스테이징된 편집 값을 서버 값 대신 보여준다', () => {
    wrap(
      <DataGrid
        columns={[{ name: 'id', type: '23' }]}
        rows={[[{ t: 'int', v: 7 }]]}
        editing={editingProps({ edits: staged(0, 'id', '9') })}
      />,
    )
    expect(screen.getByText('9')).toBeTruthy()
    expect(screen.queryByText('7')).toBeNull() // 서버 값이 남아 있으면 편집이 먹힌 줄 모른다
  })

  it('편집된 셀만 변경 표식을 단다', () => {
    const { container } = wrap(
      <DataGrid
        columns={[{ name: 'id', type: '23' }, { name: 'name', type: '25' }]}
        rows={[[{ t: 'int', v: 7 }, { t: 'str', v: 'a' }]]}
        editing={editingProps({ edits: staged(0, 'id', '9') })}
      />,
    )
    const marked = container.querySelectorAll('[data-modified]')
    expect(marked.length).toBe(1)
    expect(marked[0]?.textContent).toBe('9')
  })

  it('편집한 셀을 다시 열면 스테이징 값이 초기값이고 그대로 Enter해도 서버 값으로 안 돌아간다', () => {
    const onCommitCell = vi.fn()
    wrap(
      <DataGrid
        columns={[{ name: 'id', type: '23' }]}
        rows={[[{ t: 'int', v: 7 }]]}
        editing={editingProps({ edits: staged(0, 'id', '9'), onCommitCell })}
      />,
    )
    fireEvent.doubleClick(screen.getByText('9'))
    const input = screen.getByDisplayValue('9') // 서버 값 '7'이 아니다
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onCommitCell).toHaveBeenCalledWith(0, 'id', '9')
  })

  it('blur가 입력을 버리지 않고 커밋한다', () => {
    const onCommitCell = vi.fn()
    wrap(
      <DataGrid
        columns={[{ name: 'name', type: '25' }]}
        rows={[[{ t: 'str', v: 'a' }]]}
        editing={editingProps({ onCommitCell })}
      />,
    )
    fireEvent.doubleClick(screen.getByText('a'))
    const input = screen.getByDisplayValue('a')
    fireEvent.change(input, { target: { value: 'A' } })
    fireEvent.blur(input) // Tab·옆 셀 클릭으로 빠져나가는 경우
    expect(onCommitCell).toHaveBeenCalledWith(0, 'name', 'A')
  })

  it('값을 바꾸지 않고 빠져나가면 커밋하지 않는다', () => {
    const onCommitCell = vi.fn()
    wrap(
      <DataGrid
        columns={[{ name: 'name', type: '25' }]}
        rows={[[{ t: 'str', v: 'a' }]]}
        editing={editingProps({ onCommitCell })}
      />,
    )
    fireEvent.doubleClick(screen.getByText('a'))
    fireEvent.blur(screen.getByDisplayValue('a'))
    expect(onCommitCell).not.toHaveBeenCalled() // 열어보기만 한 셀이 UPDATE가 되면 안 된다
  })

  it('Escape는 여전히 취소다(blur 커밋과 무관)', () => {
    const onCommitCell = vi.fn()
    wrap(
      <DataGrid
        columns={[{ name: 'name', type: '25' }]}
        rows={[[{ t: 'str', v: 'a' }]]}
        editing={editingProps({ onCommitCell })}
      />,
    )
    fireEvent.doubleClick(screen.getByText('a'))
    const input = screen.getByDisplayValue('a')
    fireEvent.change(input, { target: { value: 'A' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(onCommitCell).not.toHaveBeenCalled()
    expect(screen.getByText('a')).toBeTruthy() // 편집이 닫히고 원래 값으로 돌아온다
  })

  it('NULL 버튼 mousedown이 포커스 이동을 막아 blur 커밋이 끼어들지 않는다', () => {
    const onSetNull = vi.fn()
    const onCommitCell = vi.fn()
    wrap(
      <DataGrid
        columns={[{ name: 'name', type: '25' }]}
        rows={[[{ t: 'str', v: 'a' }]]}
        editing={editingProps({ onSetNull, onCommitCell })}
      />,
    )
    fireEvent.doubleClick(screen.getByText('a'))
    fireEvent.change(screen.getByDisplayValue('a'), { target: { value: 'A' } })
    const nullButton = screen.getByLabelText('행 0 name NULL')
    // mousedown이 취소돼야 인풋이 포커스를 유지한다 — 아니면 blur가 먼저 나 'A'가
    // 커밋되고 편집 셀이 닫히면서 NULL 클릭 자체가 사라진다.
    expect(fireEvent.mouseDown(nullButton)).toBe(false)
    fireEvent.click(nullButton)
    expect(onSetNull).toHaveBeenCalledWith(0, 'name')
    expect(onCommitCell).not.toHaveBeenCalled()
  })

  it('editing 미전달이면 새-행 섹션·NULL 버튼이 없다(읽기 전용 무영향)', () => {
    wrap(<DataGrid columns={[{ name: 'name', type: '25' }]} rows={[[{ t: 'str', v: 'a' }]]} />)
    expect(screen.queryByLabelText(/NULL/)).toBeNull()
    fireEvent.doubleClick(screen.getByText('a'))
    expect(screen.queryByLabelText(/NULL/)).toBeNull()
  })
})
