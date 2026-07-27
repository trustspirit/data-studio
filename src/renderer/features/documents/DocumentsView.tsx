import { useEffect, useState } from 'react'
import styled from 'styled-components'
import type { OperationGateway } from '../../gateways/ports/OperationGateway'
import { Button, EmptyState, ErrorBanner, ListItem, Notice, Sidebar, Toolbar } from '../../shared/ui'
import { useCollections } from './model/useCollections'
import { useDocumentsData } from './model/useDocumentsData'

const DEFAULT_FILTER = '{}'

const Layout = styled.div`
  display: flex;
  height: 100%;
  min-height: 0;
  background: ${({ theme }) => theme.color.surface.bg};
  color: ${({ theme }) => theme.color.text.primary};
`
const Right = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
`
const FilterBar = styled(Toolbar)`
  align-items: flex-start;
`
const FilterInput = styled.textarea`
  flex: 1;
  min-height: 32px;
  resize: vertical;
  font-family: ${({ theme }) => theme.font.mono};
  font-size: ${({ theme }) => theme.fontSize.body};
  padding: 6px 8px;
  border-radius: ${({ theme }) => theme.radius.md};
  border: 1px solid ${({ theme }) => theme.color.border.strong};
  background: ${({ theme }) => theme.color.surface.bg};
  color: ${({ theme }) => theme.color.text.primary};
`
const Results = styled.div`
  flex: 1;
  overflow: auto;
  padding: ${({ theme }) => `${theme.space.sm} ${theme.space.md}`};
`
const Doc = styled.pre`
  margin: 0 0 ${({ theme }) => theme.space.sm} 0;
  padding: ${({ theme }) => `${theme.space.sm} ${theme.space.md}`};
  border-radius: ${({ theme }) => theme.radius.md};
  border: 1px solid ${({ theme }) => theme.color.border.soft};
  background: ${({ theme }) => theme.color.surface.panel};
  font-family: ${({ theme }) => theme.font.mono};
  font-size: ${({ theme }) => theme.fontSize.body};
  white-space: pre-wrap;
  word-break: break-word;
`

interface DocumentsViewProps {
  gateway: OperationGateway
  connectionId: string
}

/** EJSON(canonical) 문자열을 prettified JSON 텍스트로. 파싱 실패 시 원문 그대로. */
function prettify(ejson: string): string {
  try {
    return JSON.stringify(JSON.parse(ejson) as unknown, null, 2)
  } catch {
    return ejson
  }
}

export function DocumentsView({ gateway, connectionId }: DocumentsViewProps) {
  const collections = useCollections(gateway, connectionId)
  const data = useDocumentsData(gateway, connectionId)
  const [selected, setSelected] = useState<string | null>(null)
  const [filter, setFilter] = useState(DEFAULT_FILTER)

  // 연결이 바뀌면 선택·필터를 초기화한다(DataView가 selection을 리셋하는 것과 같은 이유).
  useEffect(() => { setSelected(null); setFilter(DEFAULT_FILTER) }, [connectionId])

  const handleRun = () => {
    if (selected === null) return
    data.run(selected, filter)
  }

  return (
    <Layout>
      <Sidebar>
        {collections.collections.map((name) => (
          <ListItem key={name} active={selected === name} onSelect={() => setSelected(name)}>
            {name}
          </ListItem>
        ))}
        {collections.loading && collections.collections.length === 0 && <Notice>불러오는 중…</Notice>}
        {collections.collections.length === 0 && !collections.loading && collections.error === null && (
          <Notice>컬렉션 없음</Notice>
        )}
      </Sidebar>
      <Right>
        <FilterBar>
          <FilterInput
            aria-label="filter"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <Button variant="ghost" size="sm" disabled={selected === null} onClick={handleRun}>
            Run
          </Button>
        </FilterBar>
        {collections.error !== null && <ErrorBanner>{collections.error}</ErrorBanner>}
        {data.error !== null && <ErrorBanner>{data.error}</ErrorBanner>}
        {selected === null ? (
          <EmptyState title="컬렉션을 선택하세요." hint="필터(EJSON)를 입력하고 Run으로 조회합니다" />
        ) : data.loading && data.rows.length === 0 ? (
          <Notice>불러오는 중…</Notice>
        ) : data.rows.length === 0 ? (
          <EmptyState title="결과 없음" />
        ) : (
          <Results>
            {data.rows.map((row, i) => {
              const cell = row[0]
              const text = cell !== undefined && cell.t === 'json' ? prettify(cell.v) : ''
              // 문서 순서만 있고 안정적 id가 없다(find 결과는 정렬 미보장) — index를 key로 쓴다.
              return <Doc key={i}>{text}</Doc>
            })}
            {data.hasMore && (
              <Button variant="ghost" size="sm" onClick={() => void data.loadMore()}>
                Load more
              </Button>
            )}
          </Results>
        )}
      </Right>
    </Layout>
  )
}
