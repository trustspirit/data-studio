import styled from 'styled-components'

/**
 * 뷰 상단 액션 바. 모든 뷰가 같은 높이·배경·보더를 공유해야
 * 탭을 전환할 때 크롬이 흔들리지 않는다.
 */
export const Toolbar = styled.div`
  display: flex;
  flex-shrink: 0;
  flex-wrap: wrap;
  align-items: center;
  gap: ${({ theme }) => theme.space.sm};
  padding: ${({ theme }) => `${theme.space.sm} ${theme.space.md}`};
  min-height: 48px;
  border-bottom: 1px solid ${({ theme }) => theme.color.border.soft};
  background: ${({ theme }) => theme.color.surface.base};
  font-family: ${({ theme }) => theme.font.ui};
  font-size: ${({ theme }) => theme.fontSize.label};
  color: ${({ theme }) => theme.color.text.dim};
`
Toolbar.displayName = 'Toolbar'
