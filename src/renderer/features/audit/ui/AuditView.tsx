import styled from 'styled-components'
import type { AuditEntry, OperationGateway } from '../../../gateways/ports/OperationGateway'
import { Button, EmptyState, ErrorBanner, Icon, Notice } from '../../../shared/ui'
import { useAuditLog } from '../model/useAuditLog'

const Layout = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: ${({ theme }) => theme.color.surface.bg};
  color: ${({ theme }) => theme.color.text.primary};
  font-family: ${({ theme }) => theme.font.ui};
`
const Bar = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.space.sm};
  padding: ${({ theme }) => `${theme.space.sm} ${theme.space.md}`};
  border-bottom: 1px solid ${({ theme }) => theme.color.border.strong};
  background: ${({ theme }) => theme.color.surface.panel};
`
const BarTitle = styled.h2`
  margin: 0;
  font-size: ${({ theme }) => theme.fontSize.heading};
  font-weight: 600;
`
const Count = styled.span`
  color: ${({ theme }) => theme.color.text.faint};
  font-size: ${({ theme }) => theme.fontSize.label};
`
const Spacer = styled.span`
  margin-left: auto;
`
const Scroll = styled.div`
  flex: 1;
  min-height: 0;
  overflow: auto;
`
const Table = styled.table`
  width: 100%;
  border-collapse: collapse;
  font-size: ${({ theme }) => theme.fontSize.body};
`
const Th = styled.th`
  position: sticky;
  top: 0;
  text-align: left;
  padding: ${({ theme }) => theme.density.rowPad};
  background: ${({ theme }) => theme.color.surface.base};
  border-bottom: 1px solid ${({ theme }) => theme.color.border.strong};
  color: ${({ theme }) => theme.color.text.dim};
  font-weight: 600;
  white-space: nowrap;
`
const Td = styled.td`
  padding: ${({ theme }) => theme.density.rowPad};
  border-bottom: 1px solid ${({ theme }) => theme.color.border.soft};
  vertical-align: top;
  white-space: nowrap;
`
const Statement = styled(Td)`
  font-family: ${({ theme }) => theme.font.mono};
  white-space: pre-wrap;
  word-break: break-all;
  max-width: 0;
  width: 60%;
`
const ActorBadge = styled.span<{ $ai: boolean }>`
  padding: 1px 8px;
  border-radius: 999px;
  font-size: ${({ theme }) => theme.fontSize.label};
  border: 1px solid ${({ theme }) => theme.color.border.strong};
  color: ${({ theme, $ai }) => ($ai ? theme.color.label.purple : theme.color.text.dim)};
`
const Outcome = styled.span<{ $tone: 'ok' | 'bad' | 'warn' | 'dim' }>`
  font-size: ${({ theme }) => theme.fontSize.label};
  font-weight: 600;
  color: ${({ theme, $tone }) =>
    $tone === 'ok'
      ? theme.color.intent.success
      : $tone === 'bad'
        ? theme.color.intent.danger
        : $tone === 'warn'
          ? theme.color.intent.warning
          : theme.color.text.dim};
`

function toneOf(outcome: string): 'ok' | 'bad' | 'warn' | 'dim' {
  if (outcome === 'allowed' || outcome === 'approved') return 'ok'
  if (outcome === 'denied' || outcome === 'rejected') return 'bad'
  if (outcome === 'failed') return 'warn'
  return 'dim' // proposed / expired 등
}

function timeOf(at: number): string {
  const d = new Date(at)
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`
}

interface AuditViewProps {
  gateway: OperationGateway
}

export function AuditView({ gateway }: AuditViewProps) {
  const log = useAuditLog(gateway)

  return (
    <Layout>
      <Bar>
        <BarTitle>Audit Log</BarTitle>
        <Count>{log.entries.length} entries</Count>
        <Spacer />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          data-testid="audit-refresh"
          disabled={log.loading}
          onClick={log.refresh}
        >
          <Icon name="refresh" size="sm" />
          Refresh
        </Button>
      </Bar>
      {log.error !== null && <ErrorBanner>{log.error}</ErrorBanner>}
      {log.loading && log.entries.length === 0 ? (
        <Notice>불러오는 중…</Notice>
      ) : log.entries.length === 0 ? (
        <EmptyState
          title="감사 기록이 없습니다."
          hint="쿼리 실행·AI 제안·승인이 모두 여기에 남습니다"
        />
      ) : (
        <Scroll>
          <Table data-testid="audit-table">
            <thead>
              <tr>
                <Th>Time</Th>
                <Th>Actor</Th>
                <Th>Connection</Th>
                <Th>Statement</Th>
                <Th>Outcome</Th>
              </tr>
            </thead>
            <tbody>
              {log.entries.map((e: AuditEntry) => (
                <tr key={`${e.requestId}:${e.at}:${e.outcome}`}>
                  <Td>{timeOf(e.at)}</Td>
                  <Td>
                    <ActorBadge $ai={e.actorType === 'ai'}>{e.actorType}</ActorBadge>
                  </Td>
                  <Td>{e.connectionId}</Td>
                  <Statement>{e.statement}</Statement>
                  <Td>
                    <Outcome $tone={toneOf(e.outcome)}>{e.outcome}</Outcome>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Scroll>
      )}
    </Layout>
  )
}
