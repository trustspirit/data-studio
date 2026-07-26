import styled, { css } from 'styled-components'
import type { SchemaInfo, TableInfo } from '../../../../shared/types/schema'
import type { TableSelection } from '../model/selection'

/** 트리 한 단계당 들여쓰기. 연결 → 스키마 → 테이블이 같은 간격으로 계단진다. */
const INDENT = 14

const Tree = styled.div<{ $inline: boolean }>`
  min-height: 0;
  font-family: ${({ theme }) => theme.font.ui};
  font-size: ${({ theme }) => theme.fontSize.sm};
  /* 자기 폭·배경·보더는 "사이드바 그 자체"로 쓰일 때만 갖는다. 다른 트리 안에
     중첩되면 바깥 사이드바가 이미 그것들을 갖고 있다. */
  ${({ $inline, theme }) =>
    $inline
      ? css`
          display: flex;
          flex-direction: column;
        `
      : css`
          flex: 0 0 ${theme.size.sidebar};
          width: ${theme.size.sidebar};
          overflow: auto;
          background: ${theme.color.sidebar};
          border-right: 1px solid ${theme.color.border};
        `}
`
const SchemaRow = styled.button<{ $depth: number }>`
  display: flex;
  align-items: center;
  width: 100%;
  text-align: left;
  font: inherit;
  padding: 6px 10px 6px ${({ $depth }) => 10 + $depth * INDENT}px;
  border: none;
  background: transparent;
  color: ${({ theme }) => theme.color.text};
  cursor: pointer;
  font-weight: 600;
  &:hover {
    background: ${({ theme }) => theme.color.rowHover};
  }
`
const SchemaAction = styled.span`
  margin-left: auto;
  padding: 0 6px;
  border-radius: ${({ theme }) => theme.radius.sm};
  font-size: ${({ theme }) => theme.fontSize.xs};
  color: ${({ theme }) => theme.color.textFaint};
  &:hover {
    background: ${({ theme }) => theme.color.rowHover};
    color: ${({ theme }) => theme.color.text};
  }
`
const TableRow = styled.button<{ $active: boolean; $depth: number }>`
  display: block;
  width: 100%;
  text-align: left;
  font: inherit;
  padding: 4px 10px 4px ${({ $depth }) => 24 + $depth * INDENT}px;
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
  /** 테이블을 문서로 연다. 더블클릭과 Enter가 이 콜백을 부른다. */
  onOpen: (selection: TableSelection) => void
  /** 스키마 단위 문서(ER)를 연다. 없으면 버튼이 나오지 않는다. */
  onOpenSchema?: ((schema: string) => void) | undefined
  /** 다른 트리 안에 중첩할 때 켠다 — 자기 폭·배경·보더를 쓰지 않는다. */
  inline?: boolean
  /** 들여쓰기 기준 단계. 0이면 최상위. */
  depth?: number
}

export function SchemaNavigator({
  schemas,
  tablesBySchema,
  expanded,
  selected,
  onToggle,
  onSelect,
  onOpen,
  onOpenSchema,
  inline = false,
  depth = 0,
}: SchemaNavigatorProps) {
  return (
    <Tree $inline={inline}>
      {schemas.map((s) => (
        <div key={s.name}>
          <SchemaRow type="button" $depth={depth} onClick={() => onToggle(s.name)}>
            {expanded[s.name] ? '▾ ' : '▸ '}
            {s.name}
            {onOpenSchema !== undefined && (
              <SchemaAction
                role="button"
                aria-label={`${s.name} ER 열기`}
                data-testid={`schema-open-er-${s.name}`}
                onClick={(e) => {
                  // 스키마 행 클릭은 펼치기다 — ER 열기가 그걸 겸하면 안 된다.
                  e.stopPropagation()
                  onOpenSchema(s.name)
                }}
              >
                ER
              </SchemaAction>
            )}
          </SchemaRow>
          {expanded[s.name] === true &&
            (tablesBySchema[s.name] ?? []).map((t) => {
              const active = selected?.schema === s.name && selected.table === t.name
              return (
                <TableRow
                  key={t.name}
                  type="button"
                  $active={active}
                  $depth={depth}
                  // 한 번 클릭은 고르기만 한다 — 스치듯 누른 클릭이 프로덕션
                  // 테이블을 열고 SELECT를 쏘면 안 된다(연결 행의 규칙과 같다).
                  onClick={() => onSelect({ schema: s.name, table: t.name })}
                  onDoubleClick={() => onOpen({ schema: s.name, table: t.name })}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter') return
                    e.preventDefault()
                    onOpen({ schema: s.name, table: t.name })
                  }}
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
