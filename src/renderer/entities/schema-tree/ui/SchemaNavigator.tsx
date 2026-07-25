import styled from 'styled-components'
import type { SchemaInfo, TableInfo } from '../../../../shared/types/schema'
import type { TableSelection } from '../model/selection'

const Tree = styled.div`
  flex: 0 0 ${({ theme }) => theme.size.sidebar};
  width: ${({ theme }) => theme.size.sidebar};
  min-height: 0;
  overflow: auto;
  background: ${({ theme }) => theme.color.sidebar};
  border-right: 1px solid ${({ theme }) => theme.color.border};
  font-family: ${({ theme }) => theme.font.ui};
  font-size: ${({ theme }) => theme.fontSize.sm};
`
const SchemaRow = styled.button`
  display: block;
  width: 100%;
  text-align: left;
  font: inherit;
  padding: 6px 10px;
  border: none;
  background: transparent;
  color: ${({ theme }) => theme.color.text};
  cursor: pointer;
  font-weight: 600;
  &:hover {
    background: ${({ theme }) => theme.color.rowHover};
  }
`
const TableRow = styled.button<{ $active: boolean }>`
  display: block;
  width: 100%;
  text-align: left;
  font: inherit;
  padding: 4px 10px 4px 24px;
  border: none;
  cursor: pointer;
  color: ${({ theme, $active }) => ($active ? theme.color.text : theme.color.textDim)};
  background: ${({ theme, $active }) => ($active ? theme.color.rowHover : 'transparent')};
  &:hover {
    background: ${({ theme }) => theme.color.rowHover};
    color: ${({ theme }) => theme.color.text};
  }
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
