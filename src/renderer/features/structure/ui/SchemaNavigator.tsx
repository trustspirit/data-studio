import styled from 'styled-components'
import type { SchemaInfo, TableInfo } from '../../../../shared/types/schema'
import type { TableSelection } from '../model/useTableStructure'

const Tree = styled.div`
  width: 240px;
  overflow: auto;
  border-right: 1px solid ${({ theme }) => theme.color.border};
  font: ${({ theme }) => theme.font.ui};
  font-size: 12px;
`
const SchemaRow = styled.button`
  display: block;
  width: 100%;
  text-align: left;
  padding: 6px 10px;
  border: none;
  background: transparent;
  color: ${({ theme }) => theme.color.text};
  cursor: pointer;
  font-weight: 600;
`
const TableRow = styled.button<{ $active: boolean }>`
  display: block;
  width: 100%;
  text-align: left;
  padding: 4px 10px 4px 24px;
  border: none;
  cursor: pointer;
  color: ${({ theme, $active }) => ($active ? theme.color.text : theme.color.textDim)};
  background: ${({ theme, $active }) => ($active ? theme.color.panel : 'transparent')};
`

interface SchemaNavigatorProps {
  schemas: readonly SchemaInfo[]
  tablesBySchema: Readonly<Record<string, readonly TableInfo[]>>
  expanded: Readonly<Record<string, boolean>>
  selected: TableSelection | null
  onToggle: (schema: string) => void
  onSelect: (selection: TableSelection) => void
}

export function SchemaNavigator({
  schemas,
  tablesBySchema,
  expanded,
  selected,
  onToggle,
  onSelect,
}: SchemaNavigatorProps) {
  return (
    <Tree>
      {schemas.map((s) => (
        <div key={s.name}>
          <SchemaRow type="button" onClick={() => onToggle(s.name)}>
            {expanded[s.name] ? '▾ ' : '▸ '}
            {s.name}
          </SchemaRow>
          {expanded[s.name] === true &&
            (tablesBySchema[s.name] ?? []).map((t) => {
              const active = selected?.schema === s.name && selected.table === t.name
              return (
                <TableRow
                  key={t.name}
                  type="button"
                  $active={active}
                  onClick={() => onSelect({ schema: s.name, table: t.name })}
                >
                  {t.name}
                </TableRow>
              )
            })}
        </div>
      ))}
    </Tree>
  )
}
