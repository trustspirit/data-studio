import styled from 'styled-components'

/**
 * 오류 배너. 모든 뷰가 이 한 가지 스타일만 쓴다 — 은은한 배경 틴트로
 * 본문과 구분하되, 원색 채움으로 화면을 지배하지 않는다.
 */
export const ErrorBanner = styled.div.attrs({ role: 'alert' })`
  margin: ${({ theme }) => theme.space.sm} ${({ theme }) => theme.space.md};
  padding: ${({ theme }) => theme.space.sm} ${({ theme }) => theme.space.md};
  border-radius: ${({ theme }) => theme.radius.md};
  border: 1px solid ${({ theme }) => theme.color.intentBorder.danger};
  background: ${({ theme }) => theme.color.intentSoft.danger};
  color: ${({ theme }) => theme.color.intent.danger};
  font-family: ${({ theme }) => theme.font.ui};
  font-size: ${({ theme }) => theme.fontSize.body};
  /* Postgres는 DETAIL·HINT를 여러 줄로 붙여 보낸다. 줄바꿈을 접으면 읽을 수 없다. */
  white-space: pre-wrap;
  word-break: break-word;
`
ErrorBanner.displayName = 'ErrorBanner'

/** 빈 상태·안내 문구. 콘텐츠 영역 안에서 낮은 대비로 조용히 표시한다. */
export const Notice = styled.div`
  padding: ${({ theme }) => theme.space.lg};
  color: ${({ theme }) => theme.color.fg.dim};
  font-family: ${({ theme }) => theme.font.ui};
  font-size: ${({ theme }) => theme.fontSize.body};
`
Notice.displayName = 'Notice'

const EmptyWrap = styled.div`
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: ${({ theme }) => theme.space.xs};
  padding: ${({ theme }) => theme.space.xl};
  font-family: ${({ theme }) => theme.font.ui};
  text-align: center;
`
const EmptyTitle = styled.div`
  color: ${({ theme }) => theme.color.fg.dim};
  font-size: ${({ theme }) => theme.fontSize.body};
`
const EmptyHint = styled.div`
  color: ${({ theme }) => theme.color.fg.faint};
  font-size: ${({ theme }) => theme.fontSize.body};
`

/**
 * 콘텐츠 영역 전체를 차지하는 중앙 정렬 빈 상태. 좌상단에 문구만 덜렁
 * 놓이는 것을 막는다 — 남는 공간이 "의도된 여백"으로 읽히게 한다.
 */
export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <EmptyWrap>
      <EmptyTitle>{title}</EmptyTitle>
      {hint !== undefined && <EmptyHint>{hint}</EmptyHint>}
    </EmptyWrap>
  )
}
