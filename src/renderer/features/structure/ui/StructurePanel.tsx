import styled from 'styled-components'
import type {
  ColumnInfo,
  ForeignKeyInfo,
  IndexInfo,
} from '../../../../shared/types/schema'
import { EmptyState, ErrorBanner, Notice } from '../../../shared/ui'
import { ColumnsTable } from './ColumnsTable'
import { IndexList } from './IndexList'
import { ForeignKeyList } from './ForeignKeyList'

const Panel = styled.div`
  flex: 1;
  overflow: auto;
  font-family: ${({ theme }) => theme.font.ui};
`
const SectionTitle = styled.h3`
  margin: 0;
  padding: ${({ theme }) => `${theme.space.sm} ${theme.space.md} ${theme.space.xs}`};
  font-size: ${({ theme }) => theme.fontSize.sm};
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: ${({ theme }) => theme.color.textDim};
`

interface StructurePanelProps {
  hasSelection: boolean
  loading: boolean
  error: string | null
  columns: readonly ColumnInfo[]
  indexes: readonly IndexInfo[]
  foreignKeys: readonly ForeignKeyInfo[]
  /** 행별 DDL 진입점. SQL 엔진이 아니면 넘기지 않아 버튼이 아예 나오지 않는다. */
  onRenameColumn?: (column: string) => void
  onDropColumn?: (column: string) => void
  onDropIndex?: (indexName: string) => void
}

export function StructurePanel({
  hasSelection,
  loading,
  error,
  columns,
  indexes,
  foreignKeys,
  onRenameColumn,
  onDropColumn,
  onDropIndex,
}: StructurePanelProps) {
  if (!hasSelection)
    return <EmptyState title="테이블을 선택하세요." hint="컬럼·인덱스·외래키 구조가 표시됩니다" />
  if (error !== null) return <ErrorBanner>{error}</ErrorBanner>
  if (loading) return <Notice>불러오는 중…</Notice>
  return (
    <Panel>
      <SectionTitle>Columns</SectionTitle>
      <ColumnsTable
        columns={columns}
        {...(onRenameColumn !== undefined ? { onRename: onRenameColumn } : {})}
        {...(onDropColumn !== undefined ? { onDrop: onDropColumn } : {})}
      />
      <SectionTitle>Indexes</SectionTitle>
      <IndexList
        indexes={indexes}
        {...(onDropIndex !== undefined ? { onDrop: onDropIndex } : {})}
      />
      <SectionTitle>Foreign Keys</SectionTitle>
      <ForeignKeyList foreignKeys={foreignKeys} />
    </Panel>
  )
}
