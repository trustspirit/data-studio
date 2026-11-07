import { useState } from 'react'
import styled from 'styled-components'
import type { BrowseFilter } from '../../../../shared/types/operation'
import { Button } from '../../../shared/ui'

const Form = styled.form`
  display: flex; align-items: center; flex-wrap: wrap; gap: 8px;
  padding: 8px 12px; border-bottom: 1px solid ${({ theme }) => theme.color.border.soft};
  background: ${({ theme }) => theme.color.surface.bg};
  font-size: ${({ theme }) => theme.fontSize.label};
  select, input {
    height: 32px; border: 1px solid ${({ theme }) => theme.color.border.strong};
    border-radius: ${({ theme }) => theme.radius.sm}; padding: 0 8px;
    background: ${({ theme }) => theme.color.surface.base}; color: ${({ theme }) => theme.color.text.primary}; font: inherit; min-width: 0;
  }
  input { flex: 1; min-width: 120px; max-width: 360px; }
`
export function TableFilter({ columns, active, disabled, onApply }: {
  columns: readonly string[]; active: readonly BrowseFilter[]; disabled: boolean; onApply: (filters: readonly BrowseFilter[]) => void
}) {
  const [column, setColumn] = useState('')
  const [operator, setOperator] = useState<BrowseFilter['operator']>('contains')
  const [value, setValue] = useState('')
  const target = columns.includes(column) ? column : columns[0] ?? ''
  return <Form aria-label="테이블 필터" onSubmit={(event) => {
    event.preventDefault()
    if (target === '' || disabled) return
    onApply([operator === 'isNull' || operator === 'isNotNull' ? { column: target, operator } : { column: target, operator, value }])
  }}>
    <span>필터</span>
    <select aria-label="필터 컬럼" value={target} disabled={disabled} onChange={(e) => setColumn(e.currentTarget.value)}>
      {columns.map((name) => <option key={name} value={name}>{name}</option>)}
    </select>
    <select aria-label="필터 조건" value={operator} disabled={disabled} onChange={(e) => setOperator(e.currentTarget.value as BrowseFilter['operator'])}>
      {Object.entries({ contains: '포함', eq: '같음', ne: '다름', gt: '초과', gte: '이상', lt: '미만', lte: '이하', isNull: 'NULL', isNotNull: 'NOT NULL' }).map(([key, title]) => <option key={key} value={key}>{title}</option>)}
    </select>
    {operator !== 'isNull' && operator !== 'isNotNull' && <input aria-label="필터 값" placeholder="DB 전체에서 조건 조회" value={value} disabled={disabled} maxLength={4096} onChange={(e) => setValue(e.currentTarget.value)} />}
    <Button type="submit" size="sm" variant="ghost" disabled={disabled || target === ''}>필터 적용</Button>
    {active.length > 0 && <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={() => onApply([])}>필터 해제</Button>}
  </Form>
}
