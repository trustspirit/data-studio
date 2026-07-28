import styled from 'styled-components'
import type { ConnectionConfig } from '../../shared/types/connection'
import { Button, ErrorBanner } from '../shared/ui'

const Pane = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow: auto;
  background: ${({ theme }) => theme.color.surface.bg};
`
const Body = styled.div`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: ${({ theme }) => theme.space.md};
  padding: ${({ theme }) => theme.space.xl};
  font-family: ${({ theme }) => theme.font.ui};
`
const Name = styled.h2`
  margin: 0;
  font-size: ${({ theme }) => theme.fontSize.title};
  font-weight: 600;
  color: ${({ theme }) => theme.color.text.primary};
`
const Target = styled.p`
  margin: 0;
  font-family: ${({ theme }) => theme.font.mono};
  font-size: ${({ theme }) => theme.fontSize.label};
  color: ${({ theme }) => theme.color.text.dim};
  word-break: break-all;
`
const Row = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.space.sm};
`

interface ConnectionInviteProps {
  connection: ConnectionConfig
  connecting: boolean
  error: string | null
  onConnect: () => void
  onSettings: () => void
}

/** `localhost:5432 · appdb`. 파일 기반 엔진은 호스트가 없으므로 경로만 남는다. */
function target(c: ConnectionConfig): string {
  const where = c.host === '' ? '' : `${c.host}:${String(c.port)}`
  return [c.engine, where, c.database].filter((p) => p !== '').join(' · ')
}

/**
 * 아직 접속하지 않은 연결을 골랐을 때 메인 영역에 뜨는 화면.
 *
 * 사이드바 행 클릭은 접속하지 않는다(스치듯 누른 클릭이 프로덕션 접속이 되면 안
 * 된다). 그러면 클릭에 아무 반응이 없어 막다른 길이 되는데, 그 자리를 이 패널이
 * 받는다 — 무엇을 고른 것인지 보여 주고 접속을 한 번 더 권한다.
 */
export function ConnectionInvite({
  connection,
  connecting,
  error,
  onConnect,
  onSettings,
}: ConnectionInviteProps) {
  return (
    <Pane data-testid={`invite-${connection.id}`}>
      {error !== null && error !== '' && <ErrorBanner>{error}</ErrorBanner>}
      <Body>
        <Name>{connection.name}</Name>
        <Target>{target(connection)}</Target>
        <Row>
          <Button
            type="button"
            data-testid={`invite-connect-${connection.id}`}
            disabled={connecting}
            onClick={onConnect}
          >
            {connecting ? '연결 중…' : error !== null && error !== '' ? '다시 연결' : '연결'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            data-testid={`invite-settings-${connection.id}`}
            onClick={onSettings}
          >
            설정
          </Button>
        </Row>
      </Body>
    </Pane>
  )
}
