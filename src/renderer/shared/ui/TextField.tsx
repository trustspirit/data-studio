import styled from 'styled-components'
import type { InputHTMLAttributes } from 'react'
import { controlCss } from './controls'

const Wrap = styled.label`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.space.xs};
  font-family: ${({ theme }) => theme.font.ui};
`
const Caption = styled.span`
  color: ${({ theme }) => theme.color.textDim};
  font-size: ${({ theme }) => theme.fontSize.sm};
`
const Input = styled.input<{ $invalid: boolean }>`
  ${controlCss}
  ${({ theme, $invalid }) => ($invalid ? `border-color: ${theme.color.red};` : '')}
`
const Err = styled.span`
  color: ${({ theme }) => theme.color.red};
  font-size: ${({ theme }) => theme.fontSize.sm};
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
