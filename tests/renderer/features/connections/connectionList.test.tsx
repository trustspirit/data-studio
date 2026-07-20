// @vitest-environment jsdom
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ThemeProvider, darkTheme } from '@renderer/shared/theme'
import type { ConnectionConfig } from '@shared/types/connection'
import { ConnectionList } from '@renderer/features/connections/ui/ConnectionList'

function conn(id: string, name: string): ConnectionConfig {
  return {
    id, name, engine: 'postgres', host: 'h', port: 5432, database: 'd',
    username: 'u', tlsMode: 'disable', aiReadOnlyUsername: null, maskedColumnPatterns: [],
  }
}
function wrap(node: React.ReactNode) {
  return render(<ThemeProvider theme={darkTheme}>{node}</ThemeProvider>)
}

describe('ConnectionList', () => {
  it('연결 이름을 나열하고 선택을 콜백한다', () => {
    const onSelect = vi.fn()
    wrap(
      <ConnectionList
        connections={[conn('a', 'prod'), conn('b', 'staging')]}
        selectedId={null}
        onSelect={onSelect}
        onNew={() => {}}
      />,
    )
    fireEvent.click(screen.getByText('prod'))
    expect(onSelect).toHaveBeenCalledWith('a')
  })

  it('New 버튼이 onNew를 부른다', () => {
    const onNew = vi.fn()
    wrap(<ConnectionList connections={[]} selectedId={null} onSelect={() => {}} onNew={onNew} />)
    fireEvent.click(screen.getByText(/New/i))
    expect(onNew).toHaveBeenCalledOnce()
  })
})
