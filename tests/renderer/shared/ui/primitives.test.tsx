// @vitest-environment jsdom
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ThemeProvider, darkTheme } from '@renderer/shared/theme'
import { Button, TextField, Select, ListItem } from '@renderer/shared/ui'

function wrap(node: React.ReactNode) {
  return render(<ThemeProvider theme={darkTheme}>{node}</ThemeProvider>)
}

describe('Button', () => {
  it('클릭을 전달한다', () => {
    const onClick = vi.fn()
    wrap(<Button onClick={onClick}>Save</Button>)
    fireEvent.click(screen.getByText('Save'))
    expect(onClick).toHaveBeenCalledOnce()
  })
})

describe('TextField', () => {
  it('입력값을 문자열로 콜백한다', () => {
    const onValueChange = vi.fn()
    wrap(<TextField label="Host" value="" onValueChange={onValueChange} />)
    fireEvent.change(screen.getByLabelText('Host'), { target: { value: 'db.local' } })
    // 이벤트 객체가 아니라 값 문자열을 넘겨야 한다.
    expect(onValueChange).toHaveBeenCalledWith('db.local')
  })

  it('error가 있으면 표시한다', () => {
    wrap(<TextField label="Host" value="" onValueChange={() => {}} error="required" />)
    expect(screen.getByText('required')).toBeTruthy()
  })
})

describe('Select', () => {
  it('선택값을 문자열로 콜백한다', () => {
    const onValueChange = vi.fn()
    wrap(
      <Select
        label="Engine"
        value="postgres"
        onValueChange={onValueChange}
        options={[
          { value: 'postgres', label: 'PostgreSQL' },
          { value: 'mysql', label: 'MySQL' },
        ]}
      />,
    )
    fireEvent.change(screen.getByLabelText('Engine'), { target: { value: 'mysql' } })
    expect(onValueChange).toHaveBeenCalledWith('mysql')
  })
})

describe('ListItem', () => {
  it('클릭 시 onSelect를 부른다', () => {
    const onSelect = vi.fn()
    wrap(<ListItem onSelect={onSelect}>prod</ListItem>)
    fireEvent.click(screen.getByText('prod'))
    expect(onSelect).toHaveBeenCalledOnce()
  })
})
