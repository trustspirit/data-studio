import styled from 'styled-components'

/**
 * 뷰 상단 액션 바. 모든 뷰가 같은 높이·배경·보더를 공유해야
 * 탭을 전환할 때 크롬이 흔들리지 않는다.
 */
export const Toolbar = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.space.sm};
  padding: ${({ theme }) => `${theme.space.xs} ${theme.space.md}`};
  min-height: 37px;
  border-bottom: 1px solid ${({ theme }) => theme.color.borders.strong};
  background: ${({ theme }) => theme.color.surface.panel};
  font-family: ${({ theme }) => theme.font.ui};
  font-size: ${({ theme }) => theme.fontSize.label};
  color: ${({ theme }) => theme.color.fg.dim};
`
Toolbar.displayName = 'Toolbar'
