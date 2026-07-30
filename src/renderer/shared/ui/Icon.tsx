import type { ReactElement } from 'react'
import styled, { useTheme } from 'styled-components'

export type IconName = 'chevronRight' | 'chevronDown' | 'close' | 'plus' | 'more' | 'refresh'
type IconSize = 'sm' | 'md' | 'lg'

/**
 * 16 단위 격자에 그린 도형. viewBox가 고정이라 실제 크기는 width/height만 정한다.
 *
 * 외부 아이콘 패키지를 넣지 않는다 — 지금 필요한 것은 여섯 개이고, Electron
 * 번들에 의존성 하나를 더하는 비용이 그보다 크다. 크게 늘어나면 그때 도입한다.
 */
const GLYPHS: Record<IconName, ReactElement> = {
  chevronRight: <path d="M6 12L10 8L6 4" />,
  chevronDown: <path d="M4 6L8 10L12 6" />,
  close: <path d="M12 4L4 12M4 4L12 12" />,
  plus: <path d="M8 3.5V12.5M3.5 8H12.5" />,
  // 점 셋은 획이 아니라 면이다. round cap으로 흉내 내면 stroke-width에 지름이
  // 묶여 1.8px짜리 좁쌀이 된다.
  more: (
    <g fill="currentColor" stroke="none">
      <circle cx="3.6" cy="8" r="1.3" />
      <circle cx="8" cy="8" r="1.3" />
      <circle cx="12.4" cy="8" r="1.3" />
    </g>
  ),
  refresh: (
    <>
      <path d="M13.7 10A6 6 0 1 1 12.3 3.8L15.3 6.7" />
      <path d="M15.3 2.7V6.7H11.3" />
    </>
  ),
}

const SIZE_TOKEN = { sm: 'iconSm', md: 'icon', lg: 'iconLg' } as const

/*
 * 배치만 CSS로 준다. 크기(width/height)와 획(stroke/fill)은 아래에서 **속성**으로
 * 붙인다 — SVG에서 이 둘은 기하·페인트 속성이라 상속되는 폰트 단위와 섞일 여지가
 * 없고, 스타일시트 해석에 기대지 않으므로 테스트가 결정적으로 읽을 수 있다.
 */
const Svg = styled.svg`
  flex: 0 0 auto;
  display: block;
`

interface IconProps {
  readonly name: IconName
  readonly size?: IconSize | undefined
  /**
   * 아이콘 **자신이** 의미를 나르는 드문 경우에만 준다. 아이콘이 유일한 내용인
   * 버튼은 부모 <button>이 aria-label을 갖고 아이콘은 장식으로 남아야 한다 —
   * 둘 다 이름을 가지면 스크린리더가 같은 것을 두 번 읽는다.
   */
  readonly label?: string | undefined
}

export function Icon({ name, size = 'md', label }: IconProps) {
  const theme = useTheme()
  const px = theme.size[SIZE_TOKEN[size]]
  return (
    <Svg
      viewBox="0 0 16 16"
      width={px}
      height={px}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...(label !== undefined ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
    >
      {GLYPHS[name]}
    </Svg>
  )
}
