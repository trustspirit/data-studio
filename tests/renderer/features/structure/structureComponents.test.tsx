// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ThemeProvider, darkTheme } from '@renderer/shared/theme'
import { ColumnsTable } from '@renderer/features/structure/ui/ColumnsTable'
import { ForeignKeyList } from '@renderer/features/structure/ui/ForeignKeyList'

/**
 * 이 두 단언은 원래 structurePanel.test.tsx에 얹혀 있었다. StructurePanel이
 * 죽으면서 파일째 지워졌고, 살아 있는 두 컴포넌트의 렌더 커버리지가 함께
 * 사라졌다 — TableInspector 테스트는 foreignKeys를 빈 배열로 넘기므로
 * ForeignKeyList의 렌더 경로를 한 줄도 밟지 않는다.
 */
function wrap(ui: React.ReactElement) {
  return render(<ThemeProvider theme={darkTheme}>{ui}</ThemeProvider>)
}

const COL = { name: 'id', type: 'int8', nullable: false, defaultValue: null, primaryKeyOrdinal: 1 }
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
})
