// @vitest-environment jsdom
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ThemeProvider, darkTheme } from '@renderer/shared/theme'
import type { ConnectionConfig } from '@shared/types/connection'
import { ConnectionForm } from '@renderer/features/connections/ui/ConnectionForm'

function draft(over: Partial<ConnectionConfig> = {}): ConnectionConfig {
  return {
    id: 'x', name: 'prod', engine: 'postgres', host: 'h', port: 5432, database: 'd',
    username: 'u', tlsMode: 'disable', aiReadOnlyUsername: null, maskedColumnPatterns: [], ...over,
  }
}
function wrap(node: React.ReactNode) {
  return render(<ThemeProvider theme={darkTheme}>{node}</ThemeProvider>)
}
const noop = {
  onChange: () => {},
  onEngineChange: () => {},
  onSave: () => {},
  onDelete: () => {},
  onPasswordChange: () => {},
  onBrowseFile: () => {},
  password: '',
  hasSavedSecret: false,
  secretsPersistent: true,
}

describe('ConnectionForm', () => {
  it('필드 편집이 onChange 패치를 낸다', () => {
    const onChange = vi.fn()
    wrap(<ConnectionForm draft={draft()} errors={{}} isNew={false} {...noop} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('Host'), { target: { value: 'db.local' } })
    expect(onChange).toHaveBeenCalledWith({ host: 'db.local' })
  })

  it('aiReadOnlyUsername이 null이면 경고를 표시한다', () => {
    wrap(<ConnectionForm draft={draft({ aiReadOnlyUsername: null })} errors={{}} isNew={false} {...noop} />)
    expect(screen.getByText(/AI 읽기 전용 계정 없음/)).toBeTruthy()
  })

  it('sqlite에서는 Port 필드를 숨긴다', () => {
    wrap(<ConnectionForm draft={draft({ engine: 'sqlite', port: 0 })} errors={{}} isNew={false} {...noop} />)
    expect(screen.queryByLabelText('Port')).toBeNull()
  })

  it('포트 있는 엔진에서는 Port 필드를 보여준다', () => {
    wrap(<ConnectionForm draft={draft({ engine: 'postgres', port: 5432 })} errors={{}} isNew={false} {...noop} />)
    expect(screen.getByLabelText('Port')).toBeTruthy()
  })

  it('필드 오류를 표시한다', () => {
    wrap(<ConnectionForm draft={draft({ name: '' })} errors={{ name: 'required' }} isNew={false} {...noop} />)
    expect(screen.getByText('required')).toBeTruthy()
  })

  it('Delete는 확인 후에만 onDelete를 부른다', () => {
    const onDelete = vi.fn()
    wrap(<ConnectionForm draft={draft()} errors={{}} isNew={false} {...noop} onDelete={onDelete} />)
    fireEvent.click(screen.getByText('Delete'))
    // 첫 클릭은 확인만 노출 — 아직 삭제하지 않는다.
    expect(onDelete).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText(/Confirm/i))
    expect(onDelete).toHaveBeenCalledOnce()
  })

  it('새 연결(isNew)에는 Delete가 없다', () => {
    wrap(<ConnectionForm draft={draft()} errors={{}} isNew={true} {...noop} />)
    expect(screen.queryByText('Delete')).toBeNull()
  })

  it('포트 있는 엔진에서는 Password 필드를 보여준다', () => {
    wrap(<ConnectionForm draft={draft({ engine: 'postgres' })} errors={{}} isNew={false} {...noop} />)
    expect(screen.getByLabelText('Password')).toBeTruthy()
  })

  it('sqlite에서는 Password 필드를 숨긴다', () => {
    wrap(<ConnectionForm draft={draft({ engine: 'sqlite', port: 0 })} errors={{}} isNew={false} {...noop} />)
    expect(screen.queryByLabelText('Password')).toBeNull()
  })

  it('Password 입력이 onPasswordChange를 부른다', () => {
    const onPasswordChange = vi.fn()
    wrap(
      <ConnectionForm
        draft={draft({ engine: 'postgres' })}
        errors={{}}
        isNew={false}
        {...noop}
        onPasswordChange={onPasswordChange}
      />,
    )
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 's3cret' } })
    expect(onPasswordChange).toHaveBeenCalledWith('s3cret')
  })

  it('hasSavedSecret이면 저장됨 안내를 보인다', () => {
    wrap(
      <ConnectionForm
        draft={draft({ engine: 'postgres' })}
        errors={{}}
        isNew={false}
        {...noop}
        hasSavedSecret={true}
      />,
    )
    expect(screen.getByText(/저장됨/)).toBeTruthy()
  })

  it('secretsPersistent가 false면 재입력 경고를 보인다', () => {
    wrap(
      <ConnectionForm
        draft={draft({ engine: 'postgres' })}
        errors={{}}
        isNew={false}
        {...noop}
        secretsPersistent={false}
      />,
    )
    expect(screen.getByText(/재시작 시/)).toBeTruthy()
  })

  it('엔진 드롭다운은 구현된 5개만 노출한다', () => {
    wrap(<ConnectionForm draft={draft()} errors={{}} isNew={false} {...noop} />)
    const options = [...screen.getByLabelText('Engine').querySelectorAll('option')].map(
      (o) => o.value,
    )
    expect(options.sort()).toEqual(['mariadb', 'mongodb', 'mysql', 'postgres', 'sqlite'])
  })

  it('sqlite면 네트워크 필드를 숨기고 Database file + Browse를 보인다', () => {
    wrap(
      <ConnectionForm draft={draft({ engine: 'sqlite', port: 0 })} errors={{}} isNew={false} {...noop} />,
    )
    expect(screen.queryByLabelText('Host')).toBeNull()
    expect(screen.queryByLabelText('Port')).toBeNull()
    expect(screen.queryByLabelText('User')).toBeNull()
    expect(screen.queryByLabelText('Password')).toBeNull()
    expect(screen.getByLabelText('Database file')).toBeTruthy()
    expect(screen.getByRole('button', { name: /browse/i })).toBeTruthy()
  })

  it('Browse 클릭이 onBrowseFile을 부른다', () => {
    const onBrowseFile = vi.fn()
    wrap(
      <ConnectionForm
        draft={draft({ engine: 'sqlite', port: 0 })}
        errors={{}}
        isNew={false}
        {...noop}
        onBrowseFile={onBrowseFile}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /browse/i }))
    expect(onBrowseFile).toHaveBeenCalledOnce()
  })

  it('postgres면 네트워크 필드(Host/User)를 보인다', () => {
    wrap(<ConnectionForm draft={draft({ engine: 'postgres' })} errors={{}} isNew={false} {...noop} />)
    expect(screen.getByLabelText('Host')).toBeTruthy()
    expect(screen.getByLabelText('User')).toBeTruthy()
    expect(screen.queryByLabelText('Database file')).toBeNull()
    expect(screen.getByLabelText('Database')).toBeTruthy()
  })
})
