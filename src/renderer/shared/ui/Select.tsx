import styled from 'styled-components'
import { controlCss } from './controls'

const Wrap = styled.label`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.space.xs};
  font-family: ${({ theme }) => theme.font.ui};
`
const Caption = styled.span`
  color: ${({ theme }) => theme.color.fg.dim};
  font-size: ${({ theme }) => theme.fontSize.label};
`
const Field = styled.select<{ $invalid: boolean }>`
  ${controlCss}
  ${({ theme, $invalid }) => ($invalid ? `border-color: ${theme.color.intent.danger};` : '')}
`
const Err = styled.span`
  color: ${({ theme }) => theme.color.intent.danger};
  font-size: ${({ theme }) => theme.fontSize.label};
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
