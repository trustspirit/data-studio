import styled from 'styled-components'

const Group = styled.div`
  display: inline-flex;
  border: 1px solid ${({ theme }) => theme.color.borders.strong};
  border-radius: ${({ theme }) => theme.radius.md};
  overflow: hidden;
`
const Segment = styled.button<{ $active: boolean }>`
  font-family: ${({ theme }) => theme.font.ui};
  font-size: ${({ theme }) => theme.fontSize.body};
  padding: ${({ theme }) => theme.density.controlPad};
  border: 0;
  border-right: 1px solid ${({ theme }) => theme.color.borders.strong};
  background: ${({ theme, $active }) => ($active ? theme.color.surface.raised : 'transparent')};
  color: ${({ theme }) => theme.color.fg.dim};
  cursor: pointer;
  white-space: nowrap;

  &:last-child {
    border-right: 0;
  }
  &:hover:not([aria-disabled='true']) {
    background: ${({ theme }) => theme.color.surface.base};
    color: ${({ theme }) => theme.color.fg.primary};
  }
  &[aria-disabled='true'] {
    color: ${({ theme }) => theme.color.fg.disabled};
    cursor: default;
  }
`

export interface SegmentItem {
  readonly id: string
  readonly label: string
  readonly onSelect: () => void
  readonly disabled?: boolean | undefined
  readonly active?: boolean | undefined
}

interface SegmentedGroupProps {
  items: readonly SegmentItem[]
  label: string
  testId?: string | undefined
}

/**
 * 붙은 액션 그룹. 미지원 항목을 **숨기지 않고 비활성으로 남긴다** — 이 앱은
 * 엔진마다 지원 액션이 달라, 조건부로 숨기면 탭을 옮길 때마다 그룹 폭이 바뀐다.
 * 남겨 두면 폭이 고정되고 "이 엔진은 이것을 못 한다"가 사용자에게 보인다.
 * 사라지는 버튼에서는 아무것도 배울 수 없다.
 */
export function SegmentedGroup({ items, label, testId }: SegmentedGroupProps) {
  return (
    <Group role="group" aria-label={label} {...(testId !== undefined ? { 'data-testid': testId } : {})}>
      {items.map((item) => (
        <Segment
          key={item.id}
          type="button"
          $active={item.active === true}
          aria-disabled={item.disabled === true}
          data-testid={`seg-${item.id}`}
          onClick={() => {
            if (item.disabled === true) return
            item.onSelect()
          }}
        >
          {item.label}
        </Segment>
      ))}
    </Group>
  )
}
