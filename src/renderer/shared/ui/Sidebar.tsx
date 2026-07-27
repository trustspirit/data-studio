import styled from 'styled-components'

/**
 * 뷰 좌측 네비게이션 패널. 모든 뷰가 같은 폭(theme.size.sidebar)을 쓰므로
 * 탭을 전환해도 콘텐츠 경계선이 움직이지 않는다.
 */
export const Sidebar = styled.div`
  display: flex;
  flex-direction: column;
  flex: 0 0 ${({ theme }) => theme.size.sidebar};
  width: ${({ theme }) => theme.size.sidebar};
  min-height: 0;
  overflow: auto;
  background: ${({ theme }) => theme.color.surface.base};
  border-right: 1px solid ${({ theme }) => theme.color.borders.strong};
  font-family: ${({ theme }) => theme.font.ui};
  font-size: ${({ theme }) => theme.fontSize.body};
`
Sidebar.displayName = 'Sidebar'
