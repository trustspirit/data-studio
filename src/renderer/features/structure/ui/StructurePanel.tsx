import styled from 'styled-components'
import type {
  ColumnInfo,
  ForeignKeyInfo,
  IndexInfo,
} from '../../../../shared/types/schema'
import { ColumnsTable } from './ColumnsTable'
import { IndexList } from './IndexList'
import { ForeignKeyList } from './ForeignKeyList'

const Panel = styled.div`
  flex: 1;
  overflow: auto;
  font: ${({ theme }) => theme.font.ui};
`
const SectionTitle = styled.h3`
  margin: 0;
  padding: 10px 12px 4px;
  font-size: 12px;
  color: ${({ theme }) => theme.color.textDim};
`
const Notice = styled.div`
  padding: 16px;
  color: ${({ theme }) => theme.color.textFaint};
  font-size: 13px;
`
const Banner = styled.div`
  padding: 12px 16px;
  color: ${({ theme }) => theme.color.red};
  font-size: 13px;
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
  if (error !== null) return <Banner>{error}</Banner>
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
