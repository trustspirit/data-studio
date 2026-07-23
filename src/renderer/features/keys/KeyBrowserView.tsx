import { useEffect, useState } from 'react'
import styled from 'styled-components'
import type { OperationGateway } from '../../gateways/ports/OperationGateway'
import { useKeys } from './model/useKeys'
import { useKeyValue } from './model/useKeyValue'

const Layout = styled.div`
  display: flex;
  height: 100%;
  background: ${({ theme }) => theme.color.winBg};
  color: ${({ theme }) => theme.color.text};
`
const Left = styled.div`
  display: flex;
  flex-direction: column;
  width: 260px;
  border-right: 1px solid ${({ theme }) => theme.color.border};
  min-height: 0;
`
const Toolbar = styled.div`
  display: flex;
  gap: 6px;
  padding: 8px;
  border-bottom: 1px solid ${({ theme }) => theme.color.border};
  background: ${({ theme }) => theme.color.toolbar};
`
const MatchInput = styled.input`
  flex: 1;
  min-width: 0;
  font: ${({ theme }) => theme.font.mono};
  font-size: 12px;
  padding: 4px 6px;
  border-radius: 4px;
  border: 1px solid ${({ theme }) => theme.color.border};
  background: ${({ theme }) => theme.color.panel};
  color: ${({ theme }) => theme.color.text};
`
const Btn = styled.button`
  font: ${({ theme }) => theme.font.ui};
  font-size: 12px;
  padding: 4px 12px;
  border-radius: 4px;
  border: 1px solid ${({ theme }) => theme.color.border};
  background: ${({ theme }) => theme.color.panel};
  color: ${({ theme }) => theme.color.text};
  cursor: pointer;

  &:disabled { opacity: 0.4; cursor: default; }
`
const KeyList = styled.div`
  flex: 1;
  overflow: auto;
  font: ${({ theme }) => theme.font.ui};
  font-size: 12px;
`
const KeyItem = styled.button<{ $active: boolean }>`
  display: flex;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  text-align: left;
  padding: 5px 10px;
  border: none;
  cursor: pointer;
  color: ${({ theme, $active }) => ($active ? theme.color.text : theme.color.textDim)};
  background: ${({ theme, $active }) => ($active ? theme.color.panel : 'transparent')};
`
const KeyType = styled.span`
  color: ${({ theme }) => theme.color.textFaint};
  font: ${({ theme }) => theme.font.mono};
  font-size: 11px;
`
const Right = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
`
const Meta = styled.div`
  padding: 8px 12px;
  border-bottom: 1px solid ${({ theme }) => theme.color.border};
  font: ${({ theme }) => theme.font.mono};
  font-size: 12px;
  color: ${({ theme }) => theme.color.textDim};
`
const Value = styled.pre`
  flex: 1;
  margin: 0;
  overflow: auto;
  padding: 10px 12px;
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

interface KeyBrowserViewProps {
  gateway: OperationGateway
  connectionId: string
}

/** 정규화 JSON 문자열을 prettified로. 파싱 실패 시 원문. */
function prettify(json: string): string {
  try {
    return JSON.stringify(JSON.parse(json) as unknown, null, 2)
  } catch {
    return json
  }
}

/** ttl(ms): -1 만료없음, -2 없음, 그 외 밀리초. */
function ttlLabel(ttl: number): string {
  if (ttl === -1) return 'no expiry'
  if (ttl === -2) return 'gone'
  return `${ttl} ms`
}

export function KeyBrowserView({ gateway, connectionId }: KeyBrowserViewProps) {
  const keys = useKeys(gateway, connectionId)
  const value = useKeyValue(gateway, connectionId)
  const [match, setMatch] = useState('*')
  const [selected, setSelected] = useState<string | null>(null)

  // 연결이 바뀌면 로컬 선택/입력을 초기화한다.
  useEffect(() => { setSelected(null); setMatch('*'); value.clear() }, [connectionId])

  const selectKey = (key: string) => {
    setSelected(key)
    value.load(key)
  }

  return (
    <Layout>
      <Left>
        <Toolbar>
          <MatchInput
            aria-label="match"
            value={match}
            onChange={(e) => setMatch(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') keys.run(match) }}
          />
          <Btn type="button" onClick={() => keys.run(match)}>Run</Btn>
        </Toolbar>
        {keys.error !== null && <Banner>{keys.error}</Banner>}
        <KeyList>
          {keys.keys.map((k) => (
            <KeyItem key={k.key} type="button" $active={selected === k.key} onClick={() => selectKey(k.key)}>
              <span>{k.key}</span>
              <KeyType>{k.type}</KeyType>
            </KeyItem>
          ))}
          {keys.hasMore && (
            <Btn type="button" onClick={() => void keys.loadMore()}>Load more</Btn>
          )}
        </KeyList>
      </Left>
      <Right>
        {value.error !== null && <Banner>{value.error}</Banner>}
        {selected === null ? (
          <Notice>키를 선택하세요.</Notice>
        ) : value.entry === null ? (
          <Notice>{value.loading ? '불러오는 중…' : '값 없음'}</Notice>
        ) : (
          <>
            <Meta>{value.entry.type} · {ttlLabel(value.entry.ttl)}</Meta>
            <Value>{prettify(value.entry.value)}</Value>
          </>
        )}
      </Right>
    </Layout>
  )
}
