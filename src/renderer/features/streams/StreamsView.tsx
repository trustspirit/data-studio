import { useEffect, useState } from 'react'
import styled from 'styled-components'
import type { OperationGateway } from '../../gateways/ports/OperationGateway'
import { useStreamTopics } from './model/useStreamTopics'
import { useStreamSubscription } from './model/useStreamSubscription'

const Layout = styled.div`
  display: flex;
  height: 100%;
  background: ${({ theme }) => theme.color.winBg};
  color: ${({ theme }) => theme.color.text};
`
const Left = styled.div`
  width: 220px;
  overflow: auto;
  border-right: 1px solid ${({ theme }) => theme.color.border};
  font: ${({ theme }) => theme.font.ui};
  font-size: 12px;
`
const TopicItem = styled.button<{ $active: boolean }>`
  display: block;
  width: 100%;
  text-align: left;
  padding: 6px 10px;
  border: none;
  cursor: pointer;
  color: ${({ theme, $active }) => ($active ? theme.color.text : theme.color.textDim)};
  background: ${({ theme, $active }) => ($active ? theme.color.panel : 'transparent')};
`
const Right = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
`
const Toolbar = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid ${({ theme }) => theme.color.border};
  background: ${({ theme }) => theme.color.toolbar};
`
const Btn = styled.button`
  font: ${({ theme }) => theme.font.ui};
  font-size: 12px;
  padding: 5px 14px;
  border-radius: 4px;
  border: 1px solid ${({ theme }) => theme.color.border};
  background: ${({ theme }) => theme.color.panel};
  color: ${({ theme }) => theme.color.text};
  cursor: pointer;
  &:disabled { opacity: 0.4; cursor: default; }
`
const Select = styled.select`
  font: ${({ theme }) => theme.font.ui};
  font-size: 12px;
  padding: 4px 6px;
  border-radius: 4px;
  border: 1px solid ${({ theme }) => theme.color.border};
  background: ${({ theme }) => theme.color.panel};
  color: ${({ theme }) => theme.color.text};
`
const Dropped = styled.span`
  margin-left: auto;
  color: ${({ theme }) => theme.color.red};
  font: ${({ theme }) => theme.font.ui};
  font-size: 12px;
`
const Rows = styled.div`
  flex: 1;
  overflow: auto;
  padding: 6px 12px;
`
const MsgRow = styled.pre`
  margin: 0 0 4px 0;
  font: ${({ theme }) => theme.font.mono};
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-word;
`
const Notice = styled.div`
  padding: 16px;
  color: ${({ theme }) => theme.color.textFaint};
  font: ${({ theme }) => theme.font.ui};
  font-size: 13px;
`
const Banner = styled.div`
  padding: 8px 12px;
  color: ${({ theme }) => theme.color.red};
  font: ${({ theme }) => theme.font.ui};
  font-size: 13px;
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
      <Left>
        {topics.topics.map((name) => (
          <TopicItem key={name} type="button" $active={selected === name} onClick={() => setSelected(name)}>
            {name}
          </TopicItem>
        ))}
        {topics.topics.length === 0 && !topics.loading && topics.error === null && <Notice>토픽 없음</Notice>}
      </Left>
      <Right>
        <Toolbar>
          <Select aria-label="from" value={from} onChange={(e) => setFrom(e.target.value as 'latest' | 'earliest')} disabled={sub.running}>
            <option value="latest">latest</option>
            <option value="earliest">earliest</option>
          </Select>
          {sub.running ? (
            <Btn type="button" onClick={() => void sub.stop()}>Stop</Btn>
          ) : (
            <Btn type="button" disabled={selected === null} onClick={() => selected !== null && sub.start(selected, from)}>Start</Btn>
          )}
          <Btn type="button" onClick={sub.clear}>Clear</Btn>
          {sub.dropped > 0 && <Dropped>{sub.dropped} dropped</Dropped>}
        </Toolbar>
        {topics.error !== null && <Banner>{topics.error}</Banner>}
        {sub.error !== null && <Banner>{sub.error}</Banner>}
        {selected === null ? (
          <Notice>토픽을 선택하세요.</Notice>
        ) : sub.rows.length === 0 ? (
          <Notice>{sub.running ? '메시지 대기 중…' : 'Start로 tail을 시작하세요.'}</Notice>
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
