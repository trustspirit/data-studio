import { useEffect, useState } from 'react'
import styled from 'styled-components'
import type { OperationGateway } from '../../gateways/ports/OperationGateway'
import { Button, EmptyState, ErrorBanner, ListItem, NativeSelect, Notice, Sidebar, Toolbar } from '../../shared/ui'
import { useStreamTopics } from './model/useStreamTopics'
import { useStreamSubscription } from './model/useStreamSubscription'

const Layout = styled.div`
  display: flex;
  height: 100%;
  min-height: 0;
  background: ${({ theme }) => theme.color.winBg};
  color: ${({ theme }) => theme.color.text};
`
const Right = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
`
const FromSelect = styled(NativeSelect)`
  font-size: ${({ theme }) => theme.fontSize.sm};
  padding: 4px 6px;
`
const Dropped = styled.span`
  margin-left: auto;
  color: ${({ theme }) => theme.color.red};
  font-family: ${({ theme }) => theme.font.ui};
  font-size: ${({ theme }) => theme.fontSize.sm};
`
const Rows = styled.div`
  flex: 1;
  overflow: auto;
  padding: ${({ theme }) => `${theme.space.xs} ${theme.space.md}`};
`
const MsgRow = styled.pre`
  margin: 0 0 ${({ theme }) => theme.space.xs} 0;
  font-family: ${({ theme }) => theme.font.mono};
  font-size: ${({ theme }) => theme.fontSize.sm};
  white-space: pre-wrap;
  word-break: break-word;
`

interface StreamsViewProps {
  gateway: OperationGateway
  connectionId: string
}

/** 한 행의 wire 값들을 한 줄 텍스트로. (timestamp · key · value · meta) */
function renderRow(row: readonly import('../../../shared/types/wire').WireValue[]): string {
  return row
    .map((cell) => {
      if (cell.t === 'null') return '∅'
      if (cell.t === 'str' || cell.t === 'json') return cell.v
      if (cell.t === 'int') return String(cell.v)
      return JSON.stringify(cell)
    })
    .join('  ·  ')
}

export function StreamsView({ gateway, connectionId }: StreamsViewProps) {
  const topics = useStreamTopics(gateway, connectionId)
  const sub = useStreamSubscription(gateway, connectionId)
  const [selected, setSelected] = useState<string | null>(null)
  const [from, setFrom] = useState<'latest' | 'earliest'>('latest')

  // 연결이 바뀌면 로컬 선택을 초기화한다(구독은 훅이 자체 정리).
  useEffect(() => { setSelected(null); setFrom('latest') }, [connectionId])

  return (
    <Layout>
      <Sidebar>
        {topics.loading && topics.topics.length === 0 && <Notice>불러오는 중…</Notice>}
        {topics.topics.map((name) => (
          <ListItem key={name} active={selected === name} onSelect={() => setSelected(name)}>
            {name}
          </ListItem>
        ))}
        {topics.topics.length === 0 && !topics.loading && topics.error === null && <Notice>토픽 없음</Notice>}
      </Sidebar>
      <Right>
        <Toolbar>
          <FromSelect aria-label="from" value={from} onChange={(e) => setFrom(e.target.value as 'latest' | 'earliest')} disabled={sub.running}>
            <option value="latest">latest</option>
            <option value="earliest">earliest</option>
          </FromSelect>
          {sub.running ? (
            <Button variant="secondary" size="sm" onClick={() => void sub.stop()}>Stop</Button>
          ) : (
            <Button variant="secondary" size="sm" disabled={selected === null} onClick={() => selected !== null && sub.start(selected, from)}>Start</Button>
          )}
          <Button variant="secondary" size="sm" onClick={sub.clear}>Clear</Button>
          {sub.dropped > 0 && <Dropped>{sub.dropped} dropped</Dropped>}
        </Toolbar>
        {topics.error !== null && <ErrorBanner>{topics.error}</ErrorBanner>}
        {sub.error !== null && <ErrorBanner>{sub.error}</ErrorBanner>}
        {selected === null ? (
          <EmptyState title="토픽을 선택하세요." hint="왼쪽 목록에서 토픽을 고르고 Start로 tail을 시작합니다" />
        ) : sub.rows.length === 0 ? (
          <EmptyState title={sub.running ? '메시지 대기 중…' : 'Start로 tail을 시작하세요.'} />
        ) : (
          <Rows>
            {sub.rows.map((row, i) => (
              <MsgRow key={i}>{renderRow(row)}</MsgRow>
            ))}
          </Rows>
        )}
      </Right>
    </Layout>
  )
}
