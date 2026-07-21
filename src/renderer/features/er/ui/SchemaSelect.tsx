import styled from 'styled-components'

const Select = styled.select`
  font: ${({ theme }) => theme.font.ui};
  font-size: 12px;
  padding: 3px 8px;
  border: 1px solid ${({ theme }) => theme.color.border};
  background: ${({ theme }) => theme.color.panel};
  color: ${({ theme }) => theme.color.text};
  border-radius: 4px;
`

interface Props {
  schemas: readonly string[]
  value: string | null
  onChange: (schema: string) => void
}

export function SchemaSelect({ schemas, value, onChange }: Props) {
  return (
    <Select aria-label="schema" value={value ?? ''} onChange={(e) => onChange(e.currentTarget.value)}>
      <option value="" disabled>
        스키마 선택…
      </option>
      {schemas.map((s) => (
        <option key={s} value={s}>
          {s}
        </option>
      ))}
    </Select>
  )
}
