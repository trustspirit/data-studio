import styled from 'styled-components'
import type {
  ColumnInfo,
  ForeignKeyInfo,
  IndexInfo,
} from '../../../../shared/types/schema'
import { ErrorBanner, Notice } from '../../../shared/ui'
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
}

export function StructurePanel({
  hasSelection,
  loading,
  error,
  columns,
  indexes,
  foreignKeys,
}: StructurePanelProps) {
  if (!hasSelection) return <Notice>테이블을 선택하세요.</Notice>
  if (error !== null) return <ErrorBanner>{error}</ErrorBanner>
  if (loading) return <Notice>불러오는 중…</Notice>
  return (
    <Panel>
      <SectionTitle>Columns</SectionTitle>
      <ColumnsTable columns={columns} />
      <SectionTitle>Indexes</SectionTitle>
      <IndexList indexes={indexes} />
      <SectionTitle>Foreign Keys</SectionTitle>
      <ForeignKeyList foreignKeys={foreignKeys} />
    </Panel>
  )
}
