import styled from 'styled-components'

const Wrap = styled.label`
  display: flex;
  flex-direction: column;
  gap: 4px;
  font: ${({ theme }) => theme.font.ui};
`
const Caption = styled.span`
  color: ${({ theme }) => theme.color.textDim};
  font-size: 12px;
`
const Field = styled.select<{ $invalid: boolean }>`
  font: inherit;
  padding: 6px 8px;
  border-radius: 6px;
  background: ${({ theme }) => theme.color.gridBg};
  color: ${({ theme }) => theme.color.text};
  border: 1px solid ${({ theme, $invalid }) => ($invalid ? theme.color.red : theme.color.border)};
`
const Err = styled.span`
  color: ${({ theme }) => theme.color.red};
  font-size: 12px;
`

interface Option {
  readonly value: string
  readonly label: string
}
interface Props {
  label: string
  value: string
  onValueChange: (value: string) => void
  options: readonly Option[]
  error?: string
}

export function Select({ label, value, onValueChange, options, error }: Props) {
  return (
    <Wrap>
      <Caption>{label}</Caption>
      <Field
        aria-label={label}
        value={value}
        $invalid={error !== undefined}
        onChange={(e) => onValueChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Field>
      {error !== undefined && <Err>{error}</Err>}
    </Wrap>
  )
}
