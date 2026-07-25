// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ThemeProvider, darkTheme } from '@renderer/shared/theme'
import { StructureView } from '@renderer/features/structure'
import type { OperationGateway, OperationOutcome } from '@renderer/gateways/ports/OperationGateway'
import type { EngineId } from '@shared/types/connection'

interface RanOperation {
  readonly kind: string
  readonly op?: string
  readonly sql?: string
}

const EMPTY_RESULT = {
  requestId: 'r',
  columns: [],
  rows: [],
  page: { cursor: null, hasMore: false, rowCount: 0, bytes: 0 },
  meta: { durationMs: 0, truncatedRows: false, truncatedBytes: false, rowsAffected: null },
} as const

// users(id PK, email, note) + email에 인덱스 하나. sqlite의 DROP COLUMN 사전
// 검사가 PK와 인덱스 둘 다를 봐야 하므로 두 종류를 모두 둔다.
const COLUMNS = [
  { name: 'id', type: 'bigint', nullable: false, defaultValue: null, primaryKeyOrdinal: 1 },
  { name: 'email', type: 'text', nullable: true, defaultValue: null, primaryKeyOrdinal: null },
  { name: 'note', type: 'text', nullable: true, defaultValue: null, primaryKeyOrdinal: null },
]
const INDEXES = [{ name: 'ix_users_email', columns: ['email'], unique: false, sizeBytes: null }]

function outcomeFor(op: RanOperation): OperationOutcome {
  if (op.kind === 'sql') return { ok: true, payload: { kind: 'rows', rows: EMPTY_RESULT } }
  switch (op.op) {
    case 'listSchemas':
      return { ok: true, payload: { kind: 'schemas', schemas: [{ name: 'public' }] } }
    case 'listTables':
      return {
        ok: true,
        payload: {
          kind: 'tables',
          tables: [{ schema: 'public', name: 'users', kind: 'table', estimatedRows: null }],
        },
      }
    case 'describeTable':
      return {
        ok: true,
        payload: {
          kind: 'tableDetail',
          detail: { schema: 'public', name: 'users', columns: COLUMNS },
        },
      }
    case 'listIndexes':
      return { ok: true, payload: { kind: 'indexes', indexes: INDEXES } }
    default:
      return { ok: true, payload: { kind: 'foreignKeys', foreignKeys: [] } }
  }
}

function fakeGateway() {
  const run = vi.fn((req: { operation: RanOperation }) =>
    Promise.resolve(outcomeFor(req.operation)),
  )
  const gateway: OperationGateway = {
    run,
    cancel: vi.fn().mockResolvedValue(undefined),
    recentAudit: vi.fn().mockResolvedValue([]),
    onStreamMessage: vi.fn(() => () => {}),
  }
  return { gateway, run }
}

function sqlCalls(run: ReturnType<typeof vi.fn>): string[] {
  return run.mock.calls
    .map((c) => (c as [{ operation: RanOperation }])[0].operation)
    .filter((op) => op.kind === 'sql')
    .map((op) => op.sql ?? '')
}

/** 트리에서 public.users를 고른 상태까지 진행한다. */
async function mounted(engine: EngineId = 'postgres') {
  const { gateway, run } = fakeGateway()
  render(
    <ThemeProvider theme={darkTheme}>
      <StructureView gateway={gateway} connectionId="c1" engine={engine} />
    </ThemeProvider>,
  )
  await waitFor(() => expect(screen.getByText(/public/)).toBeTruthy())
  fireEvent.click(screen.getByText(/public/))
  await waitFor(() => expect(screen.getByText('users')).toBeTruthy())
  fireEvent.click(screen.getByText('users'))
  await waitFor(() => expect(screen.getByTestId('col-rename-email')).toBeTruthy())
  return { run }
}

const runButton = () => screen.getByTestId<HTMLButtonElement>('ddl-run')

describe('테이블 이름 변경', () => {
  it('테이블을 고르기 전에는 버튼이 없다', async () => {
    const { gateway } = fakeGateway()
    render(
      <ThemeProvider theme={darkTheme}>
        <StructureView gateway={gateway} connectionId="c1" engine="postgres" />
      </ThemeProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('ddl-open-create')).toBeTruthy())
    expect(screen.queryByTestId('ddl-open-rename-table')).toBeNull()
  })

  it('새 이름을 넣으면 RENAME TO를 실행한다', async () => {
    const { run } = await mounted()
    fireEvent.click(screen.getByTestId('ddl-open-rename-table'))
    // 새 이름이 비면 실행할 수 없다.
    expect(runButton().disabled).toBe(true)
    fireEvent.change(screen.getByTestId('ddl-new-name'), { target: { value: 'members' } })
    expect(screen.getByTestId('ddl-preview').textContent).toBe(
      'ALTER TABLE "public"."users" RENAME TO "members"',
    )
    fireEvent.click(runButton())
    await waitFor(() => expect(sqlCalls(run)).toHaveLength(1))
    expect(sqlCalls(run)[0]).toContain('RENAME TO "members"')
  })
})

describe('컬럼 이름 변경', () => {
  it('컬럼 행의 Rename이 그 컬럼을 미리 골라 준다', async () => {
    const { run } = await mounted()
    fireEvent.click(screen.getByTestId('col-rename-email'))
    // 폼에서 다시 고르지 않아도 대상이 정해져 있다.
    expect(screen.getByTestId<HTMLSelectElement>('ddl-target-column').value).toBe('email')
    fireEvent.change(screen.getByTestId('ddl-new-name'), { target: { value: 'mail' } })
    fireEvent.click(runButton())
    await waitFor(() => expect(sqlCalls(run)).toHaveLength(1))
    expect(sqlCalls(run)[0]).toBe(
      'ALTER TABLE "public"."users" RENAME COLUMN "email" TO "mail"',
    )
  })
})

describe('컬럼 추가 — NOT NULL이면 DEFAULT를 요구한다', () => {
  it('DEFAULT 없이 NOT NULL을 켜면 실행이 막힌다', async () => {
    await mounted()
    fireEvent.click(screen.getByTestId('ddl-open-add-column'))
    fireEvent.change(screen.getByTestId('ddl-add-name'), { target: { value: 'status' } })
    fireEvent.change(screen.getByTestId('ddl-add-type'), { target: { value: 'text' } })
    // 여기까지는 통과한다.
    expect(runButton().disabled).toBe(false)
    fireEvent.click(screen.getByTestId('ddl-add-notnull'))
    expect(screen.getByTestId('ddl-issues').textContent).toContain('DEFAULT')
    expect(runButton().disabled).toBe(true)
  })

  it('DEFAULT를 주면 ADD COLUMN을 실행한다', async () => {
    const { run } = await mounted()
    fireEvent.click(screen.getByTestId('ddl-open-add-column'))
    fireEvent.change(screen.getByTestId('ddl-add-name'), { target: { value: 'status' } })
    fireEvent.change(screen.getByTestId('ddl-add-type'), { target: { value: 'text' } })
    fireEvent.click(screen.getByTestId('ddl-add-notnull'))
    fireEvent.change(screen.getByTestId('ddl-add-default'), { target: { value: "'draft'" } })
    expect(runButton().disabled).toBe(false)
    fireEvent.click(runButton())
    await waitFor(() => expect(sqlCalls(run)).toHaveLength(1))
    expect(sqlCalls(run)[0]).toBe(
      `ALTER TABLE "public"."users" ADD COLUMN "status" text DEFAULT 'draft' NOT NULL`,
    )
  })
})

describe('파괴적 작업 — 대상 이름을 입력해야 열린다', () => {
  it('컬럼 삭제는 이름을 정확히 입력해야 실행된다', async () => {
    const { run } = await mounted()
    fireEvent.click(screen.getByTestId('col-drop-note'))
    expect(screen.getByTestId('ddl-confirm-block')).toBeTruthy()
    expect(runButton().disabled).toBe(true)

    // 비슷하지만 다른 이름은 통과하지 못한다.
    fireEvent.change(screen.getByTestId('ddl-confirm'), { target: { value: 'not' } })
    expect(runButton().disabled).toBe(true)

    fireEvent.change(screen.getByTestId('ddl-confirm'), { target: { value: 'note' } })
    expect(runButton().disabled).toBe(false)
    fireEvent.click(runButton())
    await waitFor(() => expect(sqlCalls(run)).toHaveLength(1))
    expect(sqlCalls(run)[0]).toBe('ALTER TABLE "public"."users" DROP COLUMN "note"')
  })

  it('앞뒤 공백은 허용하지만 다른 문자는 아니다', async () => {
    await mounted()
    fireEvent.click(screen.getByTestId('col-drop-note'))
    fireEvent.change(screen.getByTestId('ddl-confirm'), { target: { value: '  note  ' } })
    expect(runButton().disabled).toBe(false)
    fireEvent.change(screen.getByTestId('ddl-confirm'), { target: { value: 'note2' } })
    expect(runButton().disabled).toBe(true)
  })

  it('테이블 삭제는 테이블 이름을 요구한다', async () => {
    const { run } = await mounted()
    fireEvent.click(screen.getByTestId('ddl-open-drop-table'))
    expect(runButton().disabled).toBe(true)
    fireEvent.change(screen.getByTestId('ddl-confirm'), { target: { value: 'users' } })
    fireEvent.click(runButton())
    await waitFor(() => expect(sqlCalls(run)).toHaveLength(1))
    expect(sqlCalls(run)[0]).toBe('DROP TABLE "public"."users"')
  })

  it('인덱스 행의 Drop이 그 인덱스를 대상으로 삼는다', async () => {
    const { run } = await mounted()
    fireEvent.click(screen.getByTestId('index-drop-ix_users_email'))
    fireEvent.change(screen.getByTestId('ddl-confirm'), {
      target: { value: 'ix_users_email' },
    })
    fireEvent.click(runButton())
    await waitFor(() => expect(sqlCalls(run)).toHaveLength(1))
    expect(sqlCalls(run)[0]).toBe('DROP INDEX "public"."ix_users_email"')
  })

  it('이름 변경처럼 되돌릴 수 있는 작업에는 확인 절차가 없다', async () => {
    await mounted()
    fireEvent.click(screen.getByTestId('ddl-open-rename-table'))
    fireEvent.change(screen.getByTestId('ddl-new-name'), { target: { value: 'members' } })
    expect(screen.queryByTestId('ddl-confirm-block')).toBeNull()
    expect(runButton().disabled).toBe(false)
  })
})

describe('sqlite의 DROP COLUMN 제약을 미리 막는다', () => {
  it('PK 컬럼은 검증에서 걸리고 확인 절차도 나오지 않는다', async () => {
    await mounted('sqlite')
    fireEvent.click(screen.getByTestId('col-drop-id'))
    expect(screen.getByTestId('ddl-issues').textContent).toContain('PK')
    // 실행할 수 없는 문장에 확인 입력을 요구하는 것은 의미가 없다.
    expect(screen.queryByTestId('ddl-confirm-block')).toBeNull()
    expect(runButton().disabled).toBe(true)
  })

  it('인덱스가 걸린 컬럼도 막는다', async () => {
    await mounted('sqlite')
    fireEvent.click(screen.getByTestId('col-drop-email'))
    expect(screen.getByTestId('ddl-issues').textContent).toContain('인덱스')
    expect(runButton().disabled).toBe(true)
  })

  it('평범한 컬럼은 통과한다', async () => {
    await mounted('sqlite')
    fireEvent.click(screen.getByTestId('col-drop-note'))
    expect(screen.queryByTestId('ddl-issues')).toBeNull()
    fireEvent.change(screen.getByTestId('ddl-confirm'), { target: { value: 'note' } })
    expect(runButton().disabled).toBe(false)
  })

  it('postgres는 같은 컬럼을 허용한다 — 엔진이 받는 것을 UI가 막지 않는다', async () => {
    await mounted('postgres')
    fireEvent.click(screen.getByTestId('col-drop-email'))
    expect(screen.queryByTestId('ddl-issues')).toBeNull()
  })
})

describe('딸려 사라지는 인덱스 경고', () => {
  it('postgres에서만 알린다 — 그쪽만 조용히 지우기 때문이다', async () => {
    await mounted('postgres')
    fireEvent.click(screen.getByTestId('col-drop-note'))
    expect(screen.getByTestId('ddl-confirm-block').textContent).toContain('인덱스도 함께')
  })

  it('sqlite에는 그 문구가 없다', async () => {
    await mounted('sqlite')
    fireEvent.click(screen.getByTestId('col-drop-note'))
    expect(screen.getByTestId('ddl-confirm-block').textContent).not.toContain('인덱스도 함께')
  })
})

describe('SQL 엔진이 아니면 행별 DDL 버튼이 없다', () => {
  it('mongodb에는 Rename/Drop이 나오지 않는다', async () => {
    const { gateway } = fakeGateway()
    render(
      <ThemeProvider theme={darkTheme}>
        <StructureView gateway={gateway} connectionId="c1" engine="mongodb" />
      </ThemeProvider>,
    )
    await waitFor(() => expect(screen.getByText(/public/)).toBeTruthy())
    fireEvent.click(screen.getByText(/public/))
    await waitFor(() => expect(screen.getByText('users')).toBeTruthy())
    fireEvent.click(screen.getByText('users'))
    await waitFor(() => expect(screen.getByText('email')).toBeTruthy())
    expect(screen.queryByTestId('col-rename-email')).toBeNull()
    expect(screen.queryByTestId('col-drop-email')).toBeNull()
    expect(screen.queryByTestId('index-drop-ix_users_email')).toBeNull()
  })
})
