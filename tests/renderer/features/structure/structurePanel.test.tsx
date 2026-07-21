// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ThemeProvider, darkTheme } from '@renderer/shared/theme'
import { StructurePanel } from '@renderer/features/structure/ui/StructurePanel'
import { ColumnsTable } from '@renderer/features/structure/ui/ColumnsTable'
import { ForeignKeyList } from '@renderer/features/structure/ui/ForeignKeyList'

function wrap(ui: React.ReactElement) {
  return render(<ThemeProvider theme={darkTheme}>{ui}</ThemeProvider>)
}
const COL = { name: 'id', type: 'int8', nullable: false, defaultValue: null, primaryKeyOrdinal: 1 }
const IDX = { name: 'users_pkey', columns: ['id'], unique: true, sizeBytes: 8192 }
const FK = {
  name: 'orders_user_fk',
  columns: ['user_id'],
  referencedSchema: 'public',
  referencedTable: 'users',
  referencedColumns: ['id'],
}

describe('구조 표시 컴포넌트', () => {
  it('ColumnsTable이 컬럼 이름·타입·PK 표시를 렌더한다', () => {
    wrap(<ColumnsTable columns={[COL]} />)
    expect(screen.getByText('id')).toBeTruthy()
    expect(screen.getByText('int8')).toBeTruthy()
    // PK ordinal 1 → 'PK1' 같은 표식. ordinal이 사라지면 이 단언이 깨진다.
    expect(screen.getByText(/PK1/)).toBeTruthy()
  })

  it('ForeignKeyList가 참조 대상을 schema.table(columns)로 렌더한다', () => {
    wrap(<ForeignKeyList foreignKeys={[FK]} />)
    expect(screen.getByText(/public\.users/)).toBeTruthy()
    expect(screen.getByText(/user_id/)).toBeTruthy()
  })

  it('StructurePanel: 선택 없으면 안내 문구, 표는 없음', () => {
    wrap(
      <StructurePanel
        hasSelection={false}
        loading={false}
        error={null}
        columns={[]}
        indexes={[]}
        foreignKeys={[]}
      />,
    )
    expect(screen.getByText(/테이블을 선택/)).toBeTruthy()
    expect(screen.queryByText('Columns')).toBeNull()
  })

  it('StructurePanel: 오류가 있으면 오류 배너를 렌더한다', () => {
    wrap(
      <StructurePanel
        hasSelection
        loading={false}
        error="read failed"
        columns={[]}
        indexes={[]}
        foreignKeys={[]}
      />,
    )
    expect(screen.getByText('read failed')).toBeTruthy()
  })

  it('StructurePanel: 선택+데이터면 세 섹션 헤더와 값이 나온다', () => {
    wrap(
      <StructurePanel
        hasSelection
        loading={false}
        error={null}
        columns={[COL]}
        indexes={[IDX]}
        foreignKeys={[FK]}
      />,
    )
    expect(screen.getByText('Columns')).toBeTruthy()
    expect(screen.getByText('Indexes')).toBeTruthy()
    expect(screen.getByText('Foreign Keys')).toBeTruthy()
    expect(screen.getByText('users_pkey')).toBeTruthy()
    expect(screen.getByText('orders_user_fk')).toBeTruthy()
  })
})
