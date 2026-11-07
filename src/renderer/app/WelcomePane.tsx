import styled from 'styled-components'
import { Button, ErrorBanner } from '../shared/ui'

const Pane = styled.section`
  flex: 1;
  overflow: auto;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: flex-start;
  gap: ${({ theme }) => theme.space.xl};
  padding: clamp(24px, 6vw, 80px);
  h1 { font-size: ${({ theme }) => theme.fontSize.title}; margin: 0; letter-spacing: -0.04em; }
  p { color: ${({ theme }) => theme.color.text.dim}; line-height: 1.7; max-width: 560px; margin: 0; }
`
const Eyebrow = styled.span`
  color: ${({ theme }) => theme.color.intent.accent};
  font-family: ${({ theme }) => theme.font.mono};
  font-size: ${({ theme }) => theme.fontSize.label};
  letter-spacing: 0.12em;
`
const Steps = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: ${({ theme }) => theme.space.lg};
  width: 100%;
  max-width: 820px;
  article {
    padding: ${({ theme }) => theme.space.lg};
    background: ${({ theme }) => theme.color.surface.base};
    border: 1px solid ${({ theme }) => theme.color.border.soft};
    border-radius: ${({ theme }) => theme.radius.lg};
  }
  h2 { font-size: ${({ theme }) => theme.fontSize.body}; margin: 0 0 8px; }
  p { font-size: ${({ theme }) => theme.fontSize.label}; }
`

export function WelcomePane({ hasConnections, error, onNew }: {
  hasConnections: boolean
  error: string | null
  onNew: () => void
}) {
  return <Pane aria-label="시작하기">
    <Eyebrow>DATABASE STUDIO</Eyebrow>
    <h1>데이터를 탐색하는 작업 공간</h1>
    <p>{hasConnections ? '사이드바에서 연결을 골라 접속하세요.' : '연결을 추가하고 첫 번째 데이터베이스를 탐색하세요.'}
      {' '}SQL 데이터베이스부터 문서·키 값 저장소와 메시지 브로커까지 한곳에서 관리합니다.</p>
    {error !== null && <ErrorBanner>{error}</ErrorBanner>}
    <Button onClick={onNew}>새 연결 추가</Button>
    <Steps>
      <article><h2>01 · 연결</h2><p>서버 정보를 입력하세요. SQLite는 로컬 파일로 바로 시작할 수 있습니다.</p></article>
      <article><h2>02 · 탐색</h2><p>테이블을 더블클릭해 데이터를 열고 구조와 관계를 확인하세요.</p></article>
      <article><h2>03 · 실행</h2><p>새 Query 탭에서 SQL을 작성하고 ⌘ / Ctrl + Enter로 실행하세요.</p></article>
    </Steps>
  </Pane>
}
