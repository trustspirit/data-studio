import { useEffect, useState } from 'react'
import styled from 'styled-components'
import type { OperationGateway } from '../../gateways/ports/OperationGateway'
import { Button, EmptyState, ErrorBanner, Input, ListItem, Notice, Sidebar, Toolbar } from '../../shared/ui'
import { useKeys } from './model/useKeys'
import { useKeyValue } from './model/useKeyValue'

const Layout = styled.div`
  display: flex;
  height: 100%;
  min-height: 0;
  background: ${({ theme }) => theme.color.surface.bg};
  color: ${({ theme }) => theme.color.text.primary};
`
const Left = styled(Sidebar)`
  overflow: hidden;
`
const MatchInput = styled(Input)`
  flex: 1;
  font-family: ${({ theme }) => theme.font.mono};
  font-size: ${({ theme }) => theme.fontSize.body};
  padding: 4px 6px;
`
const KeyList = styled.div`
  flex: 1;
  overflow: auto;
  font-family: ${({ theme }) => theme.font.ui};
  font-size: ${({ theme }) => theme.fontSize.body};
`
const KeyName = styled.span`
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`
const KeyType = styled.span`
  color: ${({ theme }) => theme.color.text.faint};
  font-family: ${({ theme }) => theme.font.mono};
  font-size: ${({ theme }) => theme.fontSize.label};
`
const Right = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
`
const Meta = styled.div`
  padding: ${({ theme }) => `${theme.space.sm} ${theme.space.md}`};
  border-bottom: 1px solid ${({ theme }) => theme.color.border.strong};
  font-family: ${({ theme }) => theme.font.mono};
  font-size: ${({ theme }) => theme.fontSize.label};
  color: ${({ theme }) => theme.color.text.dim};
`
const Value = styled.pre`
  flex: 1;
  margin: 0;
  overflow: auto;
  padding: ${({ theme }) => `${theme.space.sm} ${theme.space.md}`};
  font-family: ${({ theme }) => theme.font.mono};
  font-size: ${({ theme }) => theme.fontSize.body};
  white-space: pre-wrap;
  word-break: break-word;
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
          <Button variant="ghost" size="sm" onClick={() => keys.run(match)}>Run</Button>
        </Toolbar>
        {keys.error !== null && <ErrorBanner>{keys.error}</ErrorBanner>}
        <KeyList>
          {keys.loading && keys.keys.length === 0 && <Notice>불러오는 중…</Notice>}
          {keys.keys.map((k) => (
            <ListItem key={k.key} active={selected === k.key} onSelect={() => selectKey(k.key)}>
              <KeyName>{k.key}</KeyName>
              <KeyType>{k.type}</KeyType>
            </ListItem>
          ))}
          {keys.hasMore && (
            <Button variant="ghost" size="sm" onClick={() => void keys.loadMore()}>Load more</Button>
          )}
        </KeyList>
      </Left>
      <Right>
        {value.error !== null && <ErrorBanner>{value.error}</ErrorBanner>}
        {selected === null ? (
          <EmptyState title="키를 선택하세요." hint="왼쪽에서 패턴으로 스캔한 뒤 키를 고르세요" />
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
