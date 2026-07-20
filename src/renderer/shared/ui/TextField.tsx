import styled from 'styled-components'
import type { InputHTMLAttributes } from 'react'

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
const Input = styled.input<{ $invalid: boolean }>`
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

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> & {
  label: string
  value: string
  onValueChange: (value: string) => void
  error?: string
}

export function TextField({ label, value, onValueChange, error, ...rest }: Props) {
  return (
    <Wrap>
      <Caption>{label}</Caption>
      <Input
        aria-label={label}
        value={value}
        $invalid={error !== undefined}
        onChange={(e) => onValueChange(e.target.value)}
        {...rest}
      />
      {error !== undefined && <Err>{error}</Err>}
    </Wrap>
  )
}
