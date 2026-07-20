import styled, { css } from 'styled-components'
import type { ButtonHTMLAttributes } from 'react'

type Variant = 'primary' | 'secondary' | 'danger'

const variants = {
  primary: css`
    background: ${({ theme }) => theme.color.accent};
    color: #fff;
    border-color: transparent;
  `,
  secondary: css`
    background: ${({ theme }) => theme.color.panel};
    color: ${({ theme }) => theme.color.text};
    border-color: ${({ theme }) => theme.color.border};
  `,
  danger: css`
    background: ${({ theme }) => theme.color.red};
    color: #fff;
    border-color: transparent;
  `,
} as const

export const Button = styled.button<{ variant?: Variant }>`
  font: inherit;
  padding: 6px 14px;
  border-radius: 6px;
  border: 1px solid;
  cursor: pointer;
  ${({ variant = 'primary' }) => variants[variant]}
  &:disabled {
    opacity: 0.5;
    cursor: default;
  }
`
Button.displayName = 'Button'

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }
