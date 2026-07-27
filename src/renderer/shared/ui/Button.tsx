import styled, { css } from 'styled-components'

type Variant = 'primary' | 'ghost' | 'danger' | 'secondary'
type Size = 'sm' | 'md'

const variants = {
  primary: css`
    background: ${({ theme }) => theme.color.intent.accent};
    color: ${({ theme }) => theme.color.intent.onAccent};
    border-color: transparent;
    font-weight: ${({ theme }) => theme.fontWeight.medium};
    &:hover:not(:disabled) {
      background: ${({ theme }) => theme.color.intentHover.accent};
    }
  `,
  // 정지 상태에 테두리도 배경도 두지 않는다. 한 줄에 보조 액션이 대여섯 개
  // 늘어설 때 테두리가 그만큼 늘어나면 주요 동작이 묻힌다.
  ghost: css`
    background: transparent;
    color: ${({ theme }) => theme.color.fg.dim};
    border-color: transparent;
    &:hover:not(:disabled) {
      background: ${({ theme }) => theme.color.surface.base};
      color: ${({ theme }) => theme.color.fg.primary};
    }
  `,
  // 채우지 않는다 — 채운 빨강은 시선을 먼저 끌어 습관적 클릭을 부른다.
  danger: css`
    background: transparent;
    color: ${({ theme }) => theme.color.intent.danger};
    border-color: ${({ theme }) => theme.color.intent.danger};
    &:hover:not(:disabled) {
      background: ${({ theme }) => theme.color.intentSoft.danger};
    }
  `,
} as const
// 이관 기간 별칭. Task 14에서 제거한다.
const resolved = { ...variants, secondary: variants.ghost } as const

const sizes = {
  sm: css`
    padding: 3px 8px;
    font-size: ${({ theme }) => theme.fontSize.label};
  `,
  md: css`
    padding: ${({ theme }) => theme.density.controlPad};
    font-size: ${({ theme }) => theme.fontSize.body};
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
  ${({ variant = 'primary' }) => resolved[variant]}
  &:disabled {
    color: ${({ theme }) => theme.color.fg.disabled};
    cursor: default;
  }
`
Button.displayName = 'Button'
