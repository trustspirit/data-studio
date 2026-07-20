import type { ReactNode } from 'react'
import styled from 'styled-components'
import type { WireValue } from '../../../../shared/types/wire'

const Null = styled.span`
  color: ${({ theme }) => theme.color.textFaint};
  font-style: italic;
`
const Mono = styled.span`
  font: ${({ theme }) => theme.font.mono};
`
const Badge = styled.span`
  color: ${({ theme }) => theme.color.textDim};
  font: ${({ theme }) => theme.font.mono};
  font-size: 11px;
`
const Note = styled.span`
  color: ${({ theme }) => theme.color.textFaint};
  margin-left: 6px;
  font-size: 11px;
`

/** WireValue.t → 렌더러. 새 타입은 여기 한 줄 등록으로 끝난다(OCP). */
const CELL_RENDERERS: { [K in WireValue['t']]: (v: Extract<WireValue, { t: K }>) => ReactNode } = {
  null: () => <Null>NULL</Null>,
  bool: (v) => <span>{String(v.v)}</span>,
  int: (v) => <Mono>{v.v}</Mono>,
  float: (v) => <Mono>{v.v}</Mono>,
  bigint: (v) => <Mono>{v.v}</Mono>,
  decimal: (v) => <Mono>{v.v}</Mono>,
  str: (v) => <span>{v.v}</span>,
  bytes: (v) => <Badge>base64 · {v.v.length}</Badge>,
  date: (v) => <span>{v.v}</span>,
  json: (v) => (
    <Mono>
      {v.v}
      {v.truncated ? '…' : ''}
    </Mono>
  ),
  oid: (v) => <Mono>{v.v}</Mono>,
  unknown: (v) => (
    <span>
      {v.v}
      <Note>{v.note}</Note>
    </span>
  ),
}

export function renderCell(value: WireValue): ReactNode {
  // t로만 고른다. 미등록 t(런타임에 예상 못 한 태그)는 unknown 폴백.
  const renderer = CELL_RENDERERS[value.t] as ((v: WireValue) => ReactNode) | undefined
  if (renderer === undefined) {
    return <span>{'v' in value ? String((value as { v: unknown }).v) : ''}</span>
  }
  return renderer(value)
}
