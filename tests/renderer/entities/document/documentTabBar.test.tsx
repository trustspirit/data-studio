// @vitest-environment jsdom
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ThemeProvider, darkTheme } from '@renderer/shared/theme'
import { DocumentTabBar } from '@renderer/entities/document/ui/DocumentTabBar'
import { documentKey, type Document } from '@renderer/entities/document'

const ORDERS: Document = { kind: 'table', schema: 'public', table: 'orders' }
const QUERY: Document = { kind: 'query', serial: 1 }

function renderBar(overrides: Partial<Parameters<typeof DocumentTabBar>[0]> = {}) {
  const onActivate = vi.fn()
  const onClose = vi.fn()
  const onNewQuery = vi.fn()
  render(
    <ThemeProvider theme={darkTheme}>
      <DocumentTabBar
        documents={[ORDERS, QUERY]}
        activeKey={documentKey(ORDERS)}
        onActivate={onActivate}
        onClose={onClose}
        onNewQuery={onNewQuery}
        {...overrides}
      />
    </ThemeProvider>,
  )
  return { onActivate, onClose, onNewQuery }
}

describe('DocumentTabBar', () => {
  it('문서마다 제목이 붙은 탭을 그린다', () => {
    renderBar()
    expect(screen.getByTestId(`doctab-${documentKey(ORDERS)}`).textContent).toContain('orders')
    expect(screen.getByTestId(`doctab-${documentKey(QUERY)}`).textContent).toContain('Query 1')
  })

  it('활성 탭을 aria-selected로 표시한다', () => {
    renderBar()
    expect(screen.getByTestId(`doctab-${documentKey(ORDERS)}`).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByTestId(`doctab-${documentKey(QUERY)}`).getAttribute('aria-selected')).toBe('false')
  })

  it('탭을 누르면 활성 요청이 나간다', () => {
    const { onActivate } = renderBar()
    fireEvent.click(screen.getByTestId(`doctab-${documentKey(QUERY)}`))
    expect(onActivate).toHaveBeenCalledWith(documentKey(QUERY))
  })

  it('닫기를 눌러도 탭 활성 요청은 나가지 않는다', () => {
    const { onActivate, onClose } = renderBar()
    fireEvent.click(screen.getByTestId(`doctab-close-${documentKey(QUERY)}`))
    expect(onClose).toHaveBeenCalledWith(documentKey(QUERY))
    expect(onActivate).not.toHaveBeenCalled()
  })

  it('닫기는 다른 버튼 안에 들어 있지 않다', () => {
    // 버튼 속의 버튼은 HTML이 금지하고(role="tab" 아래로는 ARIA도 금지한다),
    // 보조 기술은 둘을 컨트롤 하나로 합쳐 버린다 — 그러면 닫기가 사라진다.
    // SchemaNavigator의 ER 버튼과 ConnectionRow가 이미 따르는 규칙이다.
    renderBar()
    const closeEl = screen.getByTestId(`doctab-close-${documentKey(QUERY)}`)
    expect(closeEl.parentElement?.closest('button')).toBeNull()
    // 반대 방향도 본다 — 탭 버튼이 닫기를 품고 있지 않아야 한다.
    expect(screen.getByTestId(`doctab-${documentKey(QUERY)}`).contains(closeEl)).toBe(false)
  })

  it('닫기는 네이티브 버튼이라 키보드로 닿고 키보드로 눌린다', () => {
    // 네이티브 <button>만이 탭 순서에 들어가고 Enter/Space를 click으로 바꾼다.
    // span[role=button]으로 두면 브라우저가 그 변환을 해 주지 않는다.
    const { onActivate, onClose } = renderBar()
    const closeEl = screen.getByTestId(`doctab-close-${documentKey(QUERY)}`)

    expect(closeEl.tagName).toBe('BUTTON')
    closeEl.focus()
    expect(document.activeElement).toBe(closeEl)
    fireEvent.click(closeEl)
    expect(onClose).toHaveBeenCalledWith(documentKey(QUERY))
    expect(onActivate).not.toHaveBeenCalled()
  })

  it('탭 자체는 tablist가 직접 소유한다', () => {
    // 제목과 닫기를 감싸는 줄이 생겼다 — 그 줄이 표현용임을 밝히지 않으면
    // tablist가 tab을 소유하지 못해 접근성 트리에서 탭 목록이 깨진다.
    renderBar()
    const tab = screen.getByTestId(`doctab-${documentKey(QUERY)}`)
    expect(tab.getAttribute('role')).toBe('tab')
    expect(tab.parentElement?.getAttribute('role')).toBe('presentation')
    expect(screen.getAllByRole('tab')).toHaveLength(2)
  })

  it('onNewQuery가 없으면 새 쿼리 버튼을 그리지 않는다', () => {
    renderBar({ onNewQuery: undefined })
    expect(screen.queryByTestId('doctab-new-query')).toBeNull()
  })

  it('새 쿼리 버튼을 누르면 콜백이 불린다', () => {
    const { onNewQuery } = renderBar()
    fireEvent.click(screen.getByTestId('doctab-new-query'))
    expect(onNewQuery).toHaveBeenCalled()
  })
})
