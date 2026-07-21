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

  it('큰 행 집합에서 전량을 DOM에 만들지 않는다 (가상화)', () => {
    const { container } = wrap(<DataGrid columns={columns} rows={rows(5000)} />)
    // 셀에 data-cell 속성을 달아 렌더된 셀 수를 센다. 5000행 x 2열 = 10000셀이면 가상화 실패.
    // 목 뷰포트(400px, 행높이 28px, overscan 12)에서 실제로 렌더되는 행은 20~40개
    // 안팎이다(약 40~80셀). 500은 그 값의 여러 배 여유를 두면서도 전량 렌더(10000)의
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
        editing={{ onCommitCell, deletedRows: new Set(), onToggleDelete: vi.fn() }}
      />,
    )
    // 'a' 셀을 더블클릭 → 인풋 → 값 입력 → Enter로 commit.
    fireEvent.doubleClick(screen.getByText('a'))
    const input = screen.getByDisplayValue('a')
    fireEvent.change(input, { target: { value: 'A' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onCommitCell).toHaveBeenCalledWith(0, 'name', 'A')
  })

  it('editing 미전달이면 셀 편집 불가(읽기 전용)', () => {
    wrap(<DataGrid columns={[{ name: 'name', type: '25' }]} rows={[[{ t: 'str', v: 'a' }]]} />)
    fireEvent.doubleClick(screen.getByText('a'))
    // 인풋이 생기지 않는다.
    expect(screen.queryByDisplayValue('a')).toBeNull()
  })
})
