import styled, { css } from 'styled-components'
import { Icon } from '../../../shared/ui'
import type { SchemaInfo, TableInfo } from '../../../../shared/types/schema'
import type { TableSelection } from '../model/selection'

/** 트리 한 단계당 들여쓰기. 연결 → 스키마 → 테이블이 같은 간격으로 계단진다. */
const INDENT = 14

const Tree = styled.div<{ $inline: boolean }>`
  min-height: 0;
  font-family: ${({ theme }) => theme.font.ui};
  font-size: ${({ theme }) => theme.fontSize.label};
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
          background: ${theme.color.surface.base};
          border-right: 1px solid ${theme.color.border.strong};
        `}
`
/**
 * 스키마 행. 펼치기와 ER 열기는 **형제** 버튼이다 — 연결 행(`ConnectionRow`)의
 * `Chevron`/`Label`/`Actions`와 같은 구조다. 액션을 라벨 버튼 **안에** 넣으면
 * 키보드로는 라벨(펼치기)에만 닿아 ER을 영영 열 수 없고, 접근성 트리에서도
 * 버튼 안의 버튼이 되어 보조 기술이 둘을 하나로 합쳐 버린다.
 */
const SchemaRow = styled.div`
  display: flex;
  align-items: center;
  /* 트리는 surface.base인 사이드바 위에 놓인다 — 상태는 틴트로만 준다. */
  &:hover {
    background: ${({ theme }) => theme.color.row.hover};
  }
`
const SchemaToggle = styled.button<{ $depth: number }>`
  flex: 1;
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.space.xs};
  min-width: 0;
  text-align: left;
  font: inherit;
  padding: 6px 10px 6px ${({ $depth }) => 10 + $depth * INDENT}px;
  border: none;
  background: transparent;
  color: ${({ theme }) => theme.color.text.primary};
  cursor: pointer;
  font-weight: 600;
`
const SchemaAction = styled.button`
  flex: 0 0 auto;
  margin-right: ${({ theme }) => theme.space.xs};
  padding: 0 6px;
  border: none;
  border-radius: ${({ theme }) => theme.radius.sm};
  background: transparent;
  font-family: ${({ theme }) => theme.font.ui};
  font-size: ${({ theme }) => theme.fontSize.label};
  color: ${({ theme }) => theme.color.text.faint};
  cursor: pointer;
  &:hover {
    background: ${({ theme }) => theme.color.row.hover};
    color: ${({ theme }) => theme.color.text.primary};
  }
`
const TableRow = styled.button<{ $active: boolean; $depth: number }>`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.space.sm};
  min-height: 32px;
  width: 100%;
  text-align: left;
  font: inherit;
  padding: 4px 10px 4px ${({ $depth }) => 24 + $depth * INDENT}px;
  border: none;
  cursor: pointer;
  color: ${({ theme, $active }) => ($active ? theme.color.text.primary : theme.color.text.dim)};
  background: ${({ theme, $active }) => ($active ? theme.color.row.selected : 'transparent')};
  box-shadow: ${({ theme, $active }) => $active ? `inset 2px 0 ${theme.color.intent.accent}` : 'none'};
  > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  &:hover {
    background: ${({ theme, $active }) =>
      $active ? theme.color.row.selected : theme.color.row.hover};
    color: ${({ theme }) => theme.color.text.primary};
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
          <SchemaRow>
            <SchemaToggle
              type="button"
              $depth={depth}
              aria-expanded={expanded[s.name] === true}
              onClick={() => onToggle(s.name)}
            >
              <Icon name={expanded[s.name] === true ? 'chevronDown' : 'chevronRight'} />
              {s.name}
            </SchemaToggle>
            {onOpenSchema !== undefined && (
              <SchemaAction
                type="button"
                aria-label={`${s.name} ER 열기`}
                data-testid={`schema-open-er-${s.name}`}
                // 형제 버튼이라 펼치기로 번지지 않는다 — stopPropagation이 필요 없다.
                onClick={() => onOpenSchema(s.name)}
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
                  title={`${s.name}.${t.name}`}
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
                  <Icon name="table" size="sm" /><span>{t.name}</span>
                </TableRow>
              )
            })}
        </div>
      ))}
    </Tree>
  )
}
