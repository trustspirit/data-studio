import styled from 'styled-components'

/**
 * 오류 배너. 모든 뷰가 이 한 가지 스타일만 쓴다 — 은은한 배경 틴트로
 * 본문과 구분하되, 원색 채움으로 화면을 지배하지 않는다.
 */
export const ErrorBanner = styled.div.attrs({ role: 'alert' })`
  margin: ${({ theme }) => theme.space.sm} ${({ theme }) => theme.space.md};
  padding: ${({ theme }) => theme.space.sm} ${({ theme }) => theme.space.md};
  border-radius: ${({ theme }) => theme.radius.md};
  border: 1px solid ${({ theme }) => theme.color.dangerBorder};
  background: ${({ theme }) => theme.color.dangerBg};
  color: ${({ theme }) => theme.color.red};
  font-family: ${({ theme }) => theme.font.ui};
  font-size: ${({ theme }) => theme.fontSize.md};
  word-break: break-word;
`
ErrorBanner.displayName = 'ErrorBanner'

/** 빈 상태·안내 문구. 콘텐츠 영역 안에서 낮은 대비로 조용히 표시한다. */
export const Notice = styled.div`
  padding: ${({ theme }) => theme.space.lg};
  color: ${({ theme }) => theme.color.textDim};
  font-family: ${({ theme }) => theme.font.ui};
  font-size: ${({ theme }) => theme.fontSize.md};
`
Notice.displayName = 'Notice'
