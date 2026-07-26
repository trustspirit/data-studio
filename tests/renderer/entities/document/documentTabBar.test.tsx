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

  it('닫기를 Enter로 눌러도 탭 활성 요청은 나가지 않는다', () => {
    const { onActivate, onClose } = renderBar()
    fireEvent.keyDown(screen.getByTestId(`doctab-close-${documentKey(QUERY)}`), { key: 'Enter' })
    expect(onClose).toHaveBeenCalledWith(documentKey(QUERY))
    expect(onActivate).not.toHaveBeenCalled()
  })

  it('닫기를 Space로 눌러도 탭 활성 요청은 나가지 않는다', () => {
    const { onActivate, onClose } = renderBar()
    fireEvent.keyDown(screen.getByTestId(`doctab-close-${documentKey(QUERY)}`), { key: ' ' })
    expect(onClose).toHaveBeenCalledWith(documentKey(QUERY))
    expect(onActivate).not.toHaveBeenCalled()
  })

  it('닫기 컨트롤은 tabIndex로 포커스를 받을 수 있다', () => {
    renderBar()
    const closeEl = screen.getByTestId(`doctab-close-${documentKey(QUERY)}`)
    closeEl.focus()
    // tabIndex가 없는 span은 .focus()를 불러도 document.activeElement가 되지 않는다 —
    // 이 단언은 tabIndex={0}이 실제로 붙어 있어야만 통과한다.
    expect(document.activeElement).toBe(closeEl)
  })

  it('닫기의 키보드 이벤트는 상위 요소로 전파되지 않는다', () => {
    const wrapperKeyDown = vi.fn()
    const onActivate = vi.fn()
    const onClose = vi.fn()
    render(
      <ThemeProvider theme={darkTheme}>
        <div onKeyDown={wrapperKeyDown}>
          <DocumentTabBar
            documents={[ORDERS, QUERY]}
            activeKey={documentKey(ORDERS)}
            onActivate={onActivate}
            onClose={onClose}
          />
        </div>
      </ThemeProvider>,
    )
    fireEvent.keyDown(screen.getByTestId(`doctab-close-${documentKey(QUERY)}`), { key: 'Enter' })
    expect(onClose).toHaveBeenCalledWith(documentKey(QUERY))
    // stopPropagation이 없으면 이 keydown이 감싸는 요소까지 버블링된다.
    expect(wrapperKeyDown).not.toHaveBeenCalled()
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
