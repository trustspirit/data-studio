import styled from 'styled-components'
import { NativeSelect } from '../../../shared/ui'

const Select = styled(NativeSelect)`
  font-size: ${({ theme }) => theme.fontSize.sm};
  padding: 4px 8px;
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
