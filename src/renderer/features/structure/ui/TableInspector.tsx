import { useEffect } from 'react'
import type { ColumnInfo, IndexInfo } from '../../../../shared/types/schema'
import type { OperationGateway } from '../../../gateways/ports/OperationGateway'
import type { TableSelection } from '../../../entities/schema-tree'
import { InspectorDock, type InspectorSection } from '../../inspector'
import { ErrorBanner, Notice } from '../../../shared/ui'
import { useTableStructure } from '../model/useTableStructure'
import { ColumnsTable } from './ColumnsTable'
import { IndexList } from './IndexList'
import { ForeignKeyList } from './ForeignKeyList'

interface TableInspectorProps {
  gateway: OperationGateway
  connectionId: string
  selection: TableSelection
  /** 값이 바뀌면 서버 기준으로 다시 읽는다(DDL 실행 후). */
  reloadToken: number
  /** 문서 종류와 무관하게 붙는 섹션(AI 등). 구조 섹션 뒤에 온다. */
  extraSections: readonly InspectorSection[]
  onRenameColumn?: ((column: string) => void) | undefined
  onDropColumn?: ((column: string) => void) | undefined
  onDropIndex?: ((indexName: string) => void) | undefined
  /** DDL 오버레이가 쓸 현재 구조를 위로 올린다. */
  onStructureLoaded?:
    | ((s: { readonly columns: readonly ColumnInfo[]; readonly indexes: readonly IndexInfo[] }) => void)
    | undefined
}

export function TableInspector({
  gateway,
  connectionId,
  selection,
  reloadToken,
  extraSections,
  onRenameColumn,
  onDropColumn,
  onDropIndex,
  onStructureLoaded,
}: TableInspectorProps) {
  const structure = useTableStructure(gateway, connectionId, selection, reloadToken)
  const { columns, indexes } = structure

  useEffect(() => {
    onStructureLoaded?.({ columns, indexes })
  }, [columns, indexes, onStructureLoaded])

  const status =
    structure.error !== null ? (
      <ErrorBanner>{structure.error}</ErrorBanner>
    ) : structure.loading ? (
      <Notice>불러오는 중…</Notice>
    ) : null

  const sections: readonly InspectorSection[] = [
    {
      id: 'columns',
      title: 'Columns',
      content:
        status ?? (
          <ColumnsTable
            columns={columns}
            {...(onRenameColumn !== undefined ? { onRename: onRenameColumn } : {})}
            {...(onDropColumn !== undefined ? { onDrop: onDropColumn } : {})}
          />
        ),
    },
    {
      id: 'indexes',
      title: 'Indexes',
      content: status ?? <IndexList indexes={indexes} {...(onDropIndex !== undefined ? { onDrop: onDropIndex } : {})} />,
    },
    {
      id: 'foreignKeys',
      title: 'Foreign Keys',
      content: status ?? <ForeignKeyList foreignKeys={structure.foreignKeys} />,
    },
    ...extraSections,
  ]

  return <InspectorDock sections={sections} initiallyOpen={['columns']} />
}
