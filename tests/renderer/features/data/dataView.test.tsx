// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { ThemeProvider, darkTheme } from '@renderer/shared/theme'
import { DataView } from '@renderer/features/data'
import type { OperationGateway, OperationOutcome } from '@renderer/gateways/ports/OperationGateway'

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, value: 800 })
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: 400 })
  Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', { configurable: true, value: () => ({ width: 800, height: 400, top: 0, left: 0, right: 800, bottom: 400, x: 0, y: 0, toJSON() {} }) })
})

interface GatewayOpts {
  pk: boolean
}

function outcomeFor(op: string, opts: GatewayOpts): OperationOutcome {
  if (op === 'listSchemas') return { ok: true, payload: { kind: 'schemas', schemas: [{ name: 'public' }] } }
  if (op === 'listTables') return { ok: true, payload: { kind: 'tables', tables: [{ schema: 'public', name: 'users', kind: 'table', estimatedRows: null }] } }
  if (op === 'describeTable') {
    return { ok: true, payload: { kind: 'tableDetail', detail: {
      schema: 'public', name: 'users',
      columns: [{ name: 'id', type: '23', nullable: false, defaultValue: null, primaryKeyOrdinal: opts.pk ? 1 : null }],
    } } }
  }
  if (op === 'apply') return { ok: true, payload: { kind: 'applied', affected: 1 } }
  // browse
  return { ok: true, payload: { kind: 'rows', rows: {
    requestId: 'r', columns: [{ name: 'id', type: '23' }], rows: [[{ t: 'int', v: 7 }]],
    page: { cursor: null, hasMore: false, rowCount: 1, bytes: 10 },
    meta: { durationMs: 1, truncatedRows: false, truncatedBytes: false, rowsAffected: null },
  } } }
}
function gateway(opts: GatewayOpts = { pk: true }): OperationGateway {
  return {
    run: vi.fn((req: { operation: { op: string } }) => Promise.resolve(outcomeFor(req.operation.op, opts))) as OperationGateway['run'],
    cancel: vi.fn().mockResolvedValue(undefined), recentAudit: vi.fn().mockResolvedValue([]),
  }
}
function wrap(ui: React.ReactElement) { return render(<ThemeProvider theme={darkTheme}>{ui}</ThemeProvider>) }

async function selectUsersTable(): Promise<void> {
  await waitFor(() => expect(screen.getByText(/public/)).toBeTruthy())
  fireEvent.click(screen.getByText(/public/))
  await waitFor(() => expect(screen.getByText('users')).toBeTruthy())
  fireEvent.click(screen.getByText('users'))
  await waitFor(() => expect(screen.getByText('7')).toBeTruthy())
}

describe('DataView', () => {
  it('스키마를 펼쳐 테이블을 고르면 행이 그리드에 뜬다', async () => {
    wrap(<DataView gateway={gateway()} connectionId="c1" />)
    await waitFor(() => expect(screen.getByText(/public/)).toBeTruthy())
    fireEvent.click(screen.getByText(/public/))
    await waitFor(() => expect(screen.getByText('users')).toBeTruthy())
    fireEvent.click(screen.getByText('users'))
    await waitFor(() => expect(screen.getByText('7')).toBeTruthy()) // 셀 값
  })

  it('처음엔 안내 문구를 보여준다', async () => {
    wrap(<DataView gateway={gateway()} connectionId="c1" />)
    await waitFor(() => expect(screen.getByText(/public/)).toBeTruthy())
    expect(screen.getByText(/테이블을 선택/)).toBeTruthy()
  })

  it('편집 후 Save가 apply를 보내고 재조회한다', async () => {
    const g = gateway({ pk: true })
    wrap(<DataView gateway={g} connectionId="c1" />)
    await selectUsersTable()

    fireEvent.doubleClick(screen.getByText('7'))
    const input = screen.getByDisplayValue('7')
    fireEvent.change(input, { target: { value: '9' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => expect(screen.getByText(/1 changes/)).toBeTruthy())
    const before = (g.run as unknown as ReturnType<typeof vi.fn>).mock.calls.length
    fireEvent.click(screen.getByText('Save'))

    await waitFor(() => {
      const calls = (g.run as unknown as ReturnType<typeof vi.fn>).mock.calls as [{ operation: { op: string } }][]
      expect(calls.some((c) => c[0].operation.op === 'apply')).toBe(true)
    })
    // reload: apply 이후 browse가 다시 호출된다(요청 수가 apply 전보다 늘어난다).
    await waitFor(() => {
      const calls = (g.run as unknown as ReturnType<typeof vi.fn>).mock.calls
      expect(calls.length).toBeGreaterThan(before + 1)
    })
  })

  it('행 삭제 후 Save가 apply의 changes에 delete를 포함한다', async () => {
    const g = gateway({ pk: true })
    wrap(<DataView gateway={g} connectionId="c1" />)
    await selectUsersTable()

    fireEvent.click(screen.getByLabelText('행 0 삭제'))
    await waitFor(() => expect(screen.getByText(/1 changes/)).toBeTruthy())
    fireEvent.click(screen.getByText('Save'))

    await waitFor(() => {
      const calls = (g.run as unknown as ReturnType<typeof vi.fn>).mock.calls as [{ operation: { op: string; changes?: unknown[] } }][]
      const applyCall = calls.find((c) => c[0].operation.op === 'apply')
      expect(applyCall).toBeDefined()
      expect(applyCall?.[0].operation.changes).toContainEqual({ op: 'delete', pk: { id: { t: 'int', v: 7 } } })
    })
  })

  it('Add row → 새 행 입력 → Save가 insert를 apply에 담아 보낸다', async () => {
    const g = gateway({ pk: true })
    wrap(<DataView gateway={g} connectionId="c1" />)
    await selectUsersTable()

    fireEvent.click(screen.getByText('Add row'))
    const input = screen.getByLabelText('새 행 0 id')
    fireEvent.change(input, { target: { value: '9' } })

    await waitFor(() => expect(screen.getByText(/1 changes/)).toBeTruthy())
    fireEvent.click(screen.getByText('Save'))

    await waitFor(() => {
      const calls = (g.run as unknown as ReturnType<typeof vi.fn>).mock.calls as [{ operation: { op: string; changes?: unknown[] } }][]
      const applyCall = calls.find((c) => c[0].operation.op === 'apply')
      expect(applyCall).toBeDefined()
      expect(applyCall?.[0].operation.changes).toContainEqual({ op: 'insert', values: { id: { t: 'str', v: '9' } } })
    })
  })

  it('PK가 없으면 편집이 비활성이다', async () => {
    wrap(<DataView gateway={gateway({ pk: false })} connectionId="c1" />)
    await selectUsersTable()

    await waitFor(() => expect(screen.getByText(/PK 없음/)).toBeTruthy())
    expect(screen.queryByText('Save')).toBeNull()
    expect(screen.queryByLabelText('행 0 삭제')).toBeNull()
  })

  it('정렬 변경 시 스테이징이 초기화된다', async () => {
    const g = gateway({ pk: true })
    wrap(<DataView gateway={g} connectionId="c1" />)
    await selectUsersTable()

    fireEvent.doubleClick(screen.getByText('7'))
    const input = screen.getByDisplayValue('7')
    fireEvent.change(input, { target: { value: '9' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(screen.getByText(/1 changes/)).toBeTruthy())

    fireEvent.click(screen.getByText('id')) // 헤더 클릭 → 정렬 변경 → 스테이징 초기화
    await waitFor(() => expect(screen.getByText(/0 changes/)).toBeTruthy())
  })
})
