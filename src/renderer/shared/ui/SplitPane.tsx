import { useRef, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import styled from 'styled-components'

/** 키보드 한 번에 움직이는 픽셀. 마우스 없이도 실용적인 보폭. */
const STEP = 16
/** 잡기 쉬운 히트 영역. 보이는 선은 1px이고 나머지는 투명 여백이다. */
const GUTTER = 7

const Wrap = styled.div<{ $dir: 'row' | 'column' }>`
  display: flex;
  flex-direction: ${({ $dir }) => $dir};
  flex: 1;
  min-width: 0;
  min-height: 0;
`
const Fixed = styled.div<{ $dir: 'row' | 'column'; $size: number }>`
  flex: 0 0 ${({ $size }) => $size}px;
  ${({ $dir, $size }) => ($dir === 'row' ? `width: ${$size}px;` : `height: ${$size}px;`)}
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
`
const Flexible = styled.div`
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
`
const Gutter = styled.div<{ $dir: 'row' | 'column' }>`
  flex: 0 0 ${GUTTER}px;
  position: relative;
  cursor: ${({ $dir }) => ($dir === 'row' ? 'col-resize' : 'row-resize')};
  background: transparent;
  touch-action: none;
  &::after {
    content: '';
    position: absolute;
    background: ${({ theme }) => theme.color.borders.strong};
    ${({ $dir }) =>
      $dir === 'row'
        ? `top: 0; bottom: 0; left: ${(GUTTER - 1) / 2}px; width: 1px;`
        : `left: 0; right: 0; top: ${(GUTTER - 1) / 2}px; height: 1px;`}
  }
  &:hover::after,
  &:focus-visible::after {
    background: ${({ theme }) => theme.color.intent.accent};
  }
`

export interface SplitPaneProps {
  /** 'row'는 좌우 분할(크기는 폭), 'column'은 상하 분할(크기는 높이). */
  direction: 'row' | 'column'
  /** 크기가 고정되는 쪽. 반대쪽이 남는 공간을 전부 먹는다. */
  anchor: 'first' | 'second'
  size: number
  min: number
  max: number
  onSizeChange: (size: number) => void
  first: ReactNode
  second: ReactNode
  /** 구분자의 접근성 이름. */
  label: string
  testId?: string | undefined
  /** 고정 쪽을 접는다 — 자식도 구분자도 그리지 않는다. */
  collapsed?: boolean | undefined
}

export function SplitPane({
  direction,
  anchor,
  size,
  min,
  max,
  onSizeChange,
  first,
  second,
  label,
  testId,
  collapsed = false,
}: SplitPaneProps) {
  /** 드래그 시작 시점의 포인터 좌표와 크기. null이면 드래그 중이 아니다. */
  const drag = useRef<{ origin: number; size: number } | null>(null)

  const clamp = (next: number) => Math.min(max, Math.max(min, Math.round(next)))
  /** anchor가 second면 포인터가 오른쪽/아래로 갈수록 고정 쪽은 좁아진다. */
  const sign = anchor === 'first' ? 1 : -1
  const coordOf = (e: { clientX: number; clientY: number }) => (direction === 'row' ? e.clientX : e.clientY)

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    drag.current = { origin: coordOf(e), size }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const start = drag.current
    if (start === null) return
    onSizeChange(clamp(start.size + sign * (coordOf(e) - start.origin)))
  }
  const endDrag = (e: PointerEvent<HTMLDivElement>) => {
    drag.current = null
    e.currentTarget.releasePointerCapture?.(e.pointerId)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const grow = direction === 'row' ? 'ArrowRight' : 'ArrowDown'
    const shrink = direction === 'row' ? 'ArrowLeft' : 'ArrowUp'
    if (e.key !== grow && e.key !== shrink) return
    e.preventDefault()
    onSizeChange(clamp(size + sign * (e.key === grow ? STEP : -STEP)))
  }

  const fixed = (
    <Fixed $dir={direction} $size={size}>
      {anchor === 'first' ? first : second}
    </Fixed>
  )
  const flexible = <Flexible>{anchor === 'first' ? second : first}</Flexible>
  const gutter = (
    <Gutter
      $dir={direction}
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation={direction === 'row' ? 'vertical' : 'horizontal'}
      aria-valuenow={size}
      aria-valuemin={min}
      aria-valuemax={max}
      {...(testId !== undefined ? { 'data-testid': testId } : {})}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
    />
  )

  if (collapsed) {
    return (
      <Wrap $dir={direction}>
        <Flexible>{anchor === 'first' ? second : first}</Flexible>
      </Wrap>
    )
  }
  return (
    <Wrap $dir={direction}>
      {anchor === 'first' ? (
        <>
          {fixed}
          {gutter}
          {flexible}
        </>
      ) : (
        <>
          {flexible}
          {gutter}
          {fixed}
        </>
      )}
    </Wrap>
  )
}
