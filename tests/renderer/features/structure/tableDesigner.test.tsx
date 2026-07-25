// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ThemeProvider, darkTheme } from '@renderer/shared/theme'
import { StructureView } from '@renderer/features/structure'
import type { OperationGateway, OperationOutcome } from '@renderer/gateways/ports/OperationGateway'

interface RanOperation {
  readonly kind: string
  readonly op?: string
  readonly sql?: string
  readonly schema?: string
  readonly table?: string
}

const EMPTY_RESULT = {
  requestId: 'r',
  columns: [],
  rows: [],
  page: { cursor: null, hasMore: false, rowCount: 0, bytes: 0 },
  meta: { durationMs: 0, truncatedRows: false, truncatedBytes: false, rowsAffected: null },
} as const

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
          detail: { schema: 'public', name: 'users', columns: [] },
        },
      }
    case 'listIndexes':
      return { ok: true, payload: { kind: 'indexes', indexes: [] } }
    default:
      return { ok: true, payload: { kind: 'foreignKeys', foreignKeys: [] } }
  }
}

function fakeGateway(overrideSql?: (sql: string) => OperationOutcome) {
  const run = vi.fn((req: { operation: RanOperation }) => {
    if (req.operation.kind === 'sql' && overrideSql !== undefined)
      return Promise.resolve(overrideSql(req.operation.sql ?? ''))
    return Promise.resolve(outcomeFor(req.operation))
  })
  const gateway: OperationGateway = {
    run,
    cancel: vi.fn().mockResolvedValue(undefined),
    recentAudit: vi.fn().mockResolvedValue([]),
    onStreamMessage: vi.fn(() => () => {}),
  }
  return { gateway, run }
}

function wrap(ui: React.ReactElement) {
  return render(<ThemeProvider theme={darkTheme}>{ui}</ThemeProvider>)
}

async function selectUsersTable() {
  await waitFor(() => expect(screen.getByText(/public/)).toBeTruthy())
  fireEvent.click(screen.getByText(/public/))
  await waitFor(() => expect(screen.getByText('users')).toBeTruthy())
  fireEvent.click(screen.getByText('users'))
}

function sqlCalls(run: ReturnType<typeof vi.fn>): string[] {
  return run.mock.calls
    .map((c) => (c as [{ operation: RanOperation }])[0].operation)
    .filter((op) => op.kind === 'sql')
    .map((op) => op.sql ?? '')
}

describe('StructureView 테이블 디자이너', () => {
  it('engine이 없으면 DDL 툴바가 표시되지 않는다', async () => {
    const { gateway } = fakeGateway()
    wrap(<StructureView gateway={gateway} connectionId="c1" />)
    await waitFor(() => expect(screen.getByText(/public/)).toBeTruthy())
    expect(screen.queryByTestId('ddl-open-create')).toBeNull()
  })

  it('SQL이 아닌 엔진(mongodb)이면 DDL 툴바가 표시되지 않는다', async () => {
    const { gateway } = fakeGateway()
    wrap(<StructureView gateway={gateway} connectionId="c1" engine="mongodb" />)
    await waitFor(() => expect(screen.getByText(/public/)).toBeTruthy())
    expect(screen.queryByTestId('ddl-open-create')).toBeNull()
  })

  it('New Table: 폼 → SQL 미리보기 → 실행 → 트리 재조회 → 닫힘', async () => {
    const { gateway, run } = fakeGateway()
    wrap(<StructureView gateway={gateway} connectionId="c1" engine="postgres" />)
    await waitFor(() => expect(screen.getByTestId('ddl-open-create')).toBeTruthy())

    fireEvent.click(screen.getByTestId('ddl-open-create'))
    // 컬럼이 비어 있으면 검증 이슈가 뜨고 Run은 비활성이다.
    expect(screen.getByTestId('ddl-issues')).toBeTruthy()
    expect(screen.getByTestId<HTMLButtonElement>('ddl-run').disabled).toBe(true)

    fireEvent.change(screen.getByTestId('ddl-table'), { target: { value: 'orders' } })
    fireEvent.change(screen.getByTestId('ddl-col-name-0'), { target: { value: 'id' } })
    fireEvent.change(screen.getByTestId('ddl-col-type-0'), { target: { value: 'bigserial' } })
    fireEvent.click(screen.getByTestId('ddl-col-pk-0'))

    const preview = screen.getByTestId('ddl-preview').textContent ?? ''
    expect(preview).toContain('CREATE TABLE "public"."orders"')
    expect(preview).toContain('"id" bigserial')
    expect(preview).toContain('PRIMARY KEY ("id")')

    const schemasCallsBefore = run.mock.calls.filter(
      (c) => (c as [{ operation: RanOperation }])[0].operation.op === 'listSchemas',
    ).length
    fireEvent.click(screen.getByTestId('ddl-run'))
    await waitFor(() => expect(screen.queryByTestId('table-designer')).toBeNull())
    expect(sqlCalls(run)[0]).toContain('CREATE TABLE "public"."orders"')
    // DDL 성공 후 스키마 트리를 다시 읽는다.
    await waitFor(() => {
      const after = run.mock.calls.filter(
        (c) => (c as [{ operation: RanOperation }])[0].operation.op === 'listSchemas',
      ).length
      expect(after).toBe(schemasCallsBefore + 1)
    })
  })

  it('+ ID를 누르면 방언에 맞는 자동 증가 PK 컬럼이 생긴다', async () => {
    const { gateway } = fakeGateway()
    wrap(<StructureView gateway={gateway} connectionId="c1" engine="postgres" />)
    await waitFor(() => expect(screen.getByTestId('ddl-open-create')).toBeTruthy())

    fireEvent.click(screen.getByTestId('ddl-open-create'))
    fireEvent.change(screen.getByTestId('ddl-table'), { target: { value: 'users' } })
    fireEvent.click(screen.getByTestId('ddl-add-id'))

    const preview = screen.getByTestId('ddl-preview').textContent ?? ''
    expect(preview).toContain('"id" bigint GENERATED BY DEFAULT AS IDENTITY')
    expect(preview).toContain('PRIMARY KEY ("id")')
    // 빈 초기 행이 남아 있으면 검증 이슈가 떠서 미리보기 자체가 안 보인다.
    expect(screen.queryByTestId('ddl-issues')).toBeNull()
  })

  it('sqlite의 + ID는 integer를 쓴다', async () => {
    // bigint는 rowid 별칭이 아니라 id가 오류 없이 비어 저장된다 — 프리셋이
    // 그 함정을 만들면 안 된다.
    const { gateway } = fakeGateway()
    wrap(<StructureView gateway={gateway} connectionId="c1" engine="sqlite" />)
    await waitFor(() => expect(screen.getByTestId('ddl-open-create')).toBeTruthy())

    fireEvent.click(screen.getByTestId('ddl-open-create'))
    fireEvent.change(screen.getByTestId('ddl-table'), { target: { value: 'users' } })
    fireEvent.click(screen.getByTestId('ddl-add-id'))

    const preview = screen.getByTestId('ddl-preview').textContent ?? ''
    expect(preview).toContain('"id" integer')
    expect(preview).toContain('PRIMARY KEY ("id" AUTOINCREMENT)')
  })

  it('AUTO를 켜면 그 행의 DEFAULT 입력이 잠기고 값이 지워진다', async () => {
    // 엔진이 거부하는 조합(both default and identity)을 애초에 만들 수 없게 한다.
    const { gateway } = fakeGateway()
    wrap(<StructureView gateway={gateway} connectionId="c1" engine="postgres" />)
    await waitFor(() => expect(screen.getByTestId('ddl-open-create')).toBeTruthy())

    fireEvent.click(screen.getByTestId('ddl-open-create'))
    const defaultInput = screen.getByTestId<HTMLInputElement>('ddl-col-default-0')
    fireEvent.change(defaultInput, { target: { value: '0' } })
    expect(defaultInput.value).toBe('0')

    fireEvent.click(screen.getByTestId('ddl-col-auto-0'))

    expect(screen.getByTestId<HTMLInputElement>('ddl-col-default-0').disabled).toBe(true)
    expect(screen.getByTestId<HTMLInputElement>('ddl-col-default-0').value).toBe('')
  })

  it('AUTO를 켠 채 타입이 맞지 않으면 이슈가 뜨고 Run이 잠긴다', async () => {
    const { gateway } = fakeGateway()
    wrap(<StructureView gateway={gateway} connectionId="c1" engine="postgres" />)
    await waitFor(() => expect(screen.getByTestId('ddl-open-create')).toBeTruthy())

    fireEvent.click(screen.getByTestId('ddl-open-create'))
    fireEvent.change(screen.getByTestId('ddl-table'), { target: { value: 'users' } })
    fireEvent.change(screen.getByTestId('ddl-col-name-0'), { target: { value: 'id' } })
    fireEvent.change(screen.getByTestId('ddl-col-type-0'), { target: { value: 'text' } })
    fireEvent.click(screen.getByTestId('ddl-col-auto-0'))

    expect(screen.getByTestId('ddl-issues').textContent).toContain('정수')
    expect(screen.getByTestId<HTMLButtonElement>('ddl-run').disabled).toBe(true)
  })

  it('실행이 거부되면 이유를 보여주고 디자이너를 유지한다', async () => {
    const { gateway } = fakeGateway(() => ({ ok: false, reason: 'permission denied' }))
    wrap(<StructureView gateway={gateway} connectionId="c1" engine="postgres" />)
    await waitFor(() => expect(screen.getByTestId('ddl-open-create')).toBeTruthy())

    fireEvent.click(screen.getByTestId('ddl-open-create'))
    fireEvent.change(screen.getByTestId('ddl-table'), { target: { value: 't' } })
    fireEvent.change(screen.getByTestId('ddl-col-name-0'), { target: { value: 'a' } })
    fireEvent.change(screen.getByTestId('ddl-col-type-0'), { target: { value: 'text' } })
    fireEvent.click(screen.getByTestId('ddl-run'))

    await waitFor(() => expect(screen.getByText(/permission denied/)).toBeTruthy())
    expect(screen.getByTestId('table-designer')).toBeTruthy()
  })

  it('테이블을 선택하면 Add FK·Add Index가 나타나고, FK 폼이 ALTER TABLE을 만든다', async () => {
    const { gateway, run } = fakeGateway()
    wrap(<StructureView gateway={gateway} connectionId="c1" engine="postgres" />)
    await selectUsersTable()
    await waitFor(() => expect(screen.getByTestId('ddl-open-fk')).toBeTruthy())

    fireEvent.click(screen.getByTestId('ddl-open-fk'))
    fireEvent.change(screen.getByTestId('ddl-fk-columns'), { target: { value: 'org_id' } })
    fireEvent.change(screen.getByTestId('ddl-fk-ref-table'), { target: { value: 'orgs' } })
    fireEvent.change(screen.getByTestId('ddl-fk-ref-columns'), { target: { value: 'id' } })

    const preview = screen.getByTestId('ddl-preview').textContent ?? ''
    expect(preview).toContain('ALTER TABLE "public"."users"')
    expect(preview).toContain('REFERENCES "public"."orgs" ("id")')

    fireEvent.click(screen.getByTestId('ddl-run'))
    await waitFor(() => expect(screen.queryByTestId('table-designer')).toBeNull())
    expect(sqlCalls(run)[0]).toContain('ADD FOREIGN KEY ("org_id")')
  })

  it('sqlite에서는 Add FK 버튼이 없다(ALTER 미지원)', async () => {
    const { gateway } = fakeGateway()
    wrap(<StructureView gateway={gateway} connectionId="c1" engine="sqlite" />)
    await selectUsersTable()
    await waitFor(() => expect(screen.getByTestId('ddl-open-index')).toBeTruthy())
    expect(screen.queryByTestId('ddl-open-fk')).toBeNull()
  })

  it('Add Index 폼이 CREATE INDEX를 만들어 실행한다', async () => {
    const { gateway, run } = fakeGateway()
    wrap(<StructureView gateway={gateway} connectionId="c1" engine="mysql" />)
    await selectUsersTable()
    await waitFor(() => expect(screen.getByTestId('ddl-open-index')).toBeTruthy())

    fireEvent.click(screen.getByTestId('ddl-open-index'))
    fireEvent.change(screen.getByTestId('ddl-index-name'), { target: { value: 'idx_users_email' } })
    fireEvent.change(screen.getByTestId('ddl-index-columns'), { target: { value: 'email' } })

    const preview = screen.getByTestId('ddl-preview').textContent ?? ''
    expect(preview).toBe('CREATE INDEX `idx_users_email` ON `public`.`users` (`email`)')

    fireEvent.click(screen.getByTestId('ddl-run'))
    await waitFor(() => expect(screen.queryByTestId('table-designer')).toBeNull())
    expect(sqlCalls(run)).toHaveLength(1)
  })
})
