import styled, { css } from 'styled-components'

type Variant = 'primary' | 'secondary' | 'danger'
type Size = 'sm' | 'md'

const variants = {
  primary: css`
    background: ${({ theme }) => theme.color.accent};
    color: ${({ theme }) => theme.color.onAccent};
    border-color: transparent;
    &:hover:not(:disabled) {
      background: ${({ theme }) => theme.color.blue};
    }
  `,
  secondary: css`
    background: ${({ theme }) => theme.color.panel};
    color: ${({ theme }) => theme.color.text};
    border-color: ${({ theme }) => theme.color.border};
    &:hover:not(:disabled) {
      background: ${({ theme }) => theme.color.rowHover};
    }
  `,
  danger: css`
    background: ${({ theme }) => theme.color.red};
    color: ${({ theme }) => theme.color.onDanger};
    border-color: transparent;
    &:hover:not(:disabled) {
      filter: brightness(1.1);
    }
  `,
} as const

const sizes = {
  sm: css`
    padding: 4px 10px;
    font-size: ${({ theme }) => theme.fontSize.sm};
  `,
  md: css`
    padding: 6px 14px;
    font-size: ${({ theme }) => theme.fontSize.md};
  `,
} as const

export const Button = styled.button<{ variant?: Variant; size?: Size }>`
  font-family: ${({ theme }) => theme.font.ui};
  border-radius: ${({ theme }) => theme.radius.md};
  border: 1px solid;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.12s ease;
  ${({ size = 'md' }) => sizes[size]}
  ${({ variant = 'primary' }) => variants[variant]}
  &:disabled {
    opacity: 0.5;
    cursor: default;
  }
`
Button.displayName = 'Button'
