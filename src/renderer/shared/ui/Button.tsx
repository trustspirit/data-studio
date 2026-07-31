import styled, { css } from 'styled-components'

type Variant = 'primary' | 'ghost' | 'danger'
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
    color: ${({ theme }) => theme.color.text.dim};
    border-color: transparent;
    &:hover:not(:disabled) {
      background: ${({ theme }) => theme.color.surface.base};
      color: ${({ theme }) => theme.color.text.primary};
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

/*
 * 크기는 **높이가 정한다.** 세로 패딩은 두 크기 모두 0이고 가로 패딩은 공유한다 —
 * 패딩으로 크기를 내면 글자 크기가 바뀔 때마다 높이가 따라 흔들리고, 한 툴바 안의
 * 컨트롤들이 서로 다른 높이에 선다. 그리드 행에서 이미 검증된 방식이다.
 */
const sizes = {
  sm: css`
    height: ${({ theme }) => theme.density.controlHeightSm};
    font-size: ${({ theme }) => theme.fontSize.label};
  `,
  md: css`
    height: ${({ theme }) => theme.density.controlHeight};
    font-size: ${({ theme }) => theme.fontSize.body};
  `,
} as const

export const Button = styled.button<{ variant?: Variant; size?: Size }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  /* 아이콘과 라벨을 함께 넣는 버튼(AuditView의 새로고침)이 있다. */
  gap: ${({ theme }) => theme.space.xs};
  padding: ${({ theme }) => theme.density.controlPad};
  font-family: ${({ theme }) => theme.font.ui};
  border-radius: ${({ theme }) => theme.radius.md};
  border: 1px solid;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.12s ease;
  ${({ size = 'md' }) => sizes[size]}
  ${({ variant = 'primary' }) => variants[variant]}
  /*
   * 비활성은 변형과 무관하게 같은 중립 판이 된다. 글자만 흐리면 primary는 강조색
   * 채움을 그대로 지닌 채 읽을 수 없는 라벨이 되고, ghost는 배경도 테두리도 없어
   * 빈 공간과 구별되지 않는다 — DataView의 되돌리기·저장과 AI 보내기 버튼은
   * **정지 상태가 곧 비활성**이라 이것이 평소 화면이다. 테두리는 판이 컨테이너와
   * 같은 단에 놓여도 컨트롤의 경계를 남긴다.
   */
  &:disabled {
    background: ${({ theme }) => theme.color.surface.base};
    border-color: ${({ theme }) => theme.color.border.soft};
    color: ${({ theme }) => theme.color.text.disabled};
    cursor: default;
  }
`
Button.displayName = 'Button'
