import { useEffect, useState } from 'react'
import styled from 'styled-components'
import type { OperationGateway } from '../../gateways/ports/OperationGateway'
import { useCollections } from './model/useCollections'
import { useDocumentsData } from './model/useDocumentsData'

const DEFAULT_FILTER = '{}'

const Layout = styled.div`
  display: flex;
  height: 100%;
  background: ${({ theme }) => theme.color.winBg};
  color: ${({ theme }) => theme.color.text};
`
const Left = styled.div`
  width: 200px;
  overflow: auto;
  border-right: 1px solid ${({ theme }) => theme.color.border};
  font: ${({ theme }) => theme.font.ui};
  font-size: 12px;
`
const CollectionItem = styled.button<{ $active: boolean }>`
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
  align-items: flex-start;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid ${({ theme }) => theme.color.border};
  background: ${({ theme }) => theme.color.toolbar};
`
const FilterInput = styled.textarea`
  flex: 1;
  min-height: 32px;
  resize: vertical;
  font: ${({ theme }) => theme.font.mono};
  font-size: 12px;
  padding: 6px 8px;
  border-radius: 4px;
  border: 1px solid ${({ theme }) => theme.color.border};
  background: ${({ theme }) => theme.color.panel};
  color: ${({ theme }) => theme.color.text};
`
const RunButton = styled.button`
  font: ${({ theme }) => theme.font.ui};
  font-size: 12px;
  padding: 6px 14px;
  border-radius: 4px;
  border: 1px solid ${({ theme }) => theme.color.border};
  background: ${({ theme }) => theme.color.panel};
  color: ${({ theme }) => theme.color.text};
  cursor: pointer;

  &:disabled {
    opacity: 0.4;
    cursor: default;
  }
`
const Results = styled.div`
  flex: 1;
  overflow: auto;
  padding: 8px 12px;
`
const Doc = styled.pre`
  margin: 0 0 10px 0;
  padding: 8px 10px;
  border-radius: 4px;
  border: 1px solid ${({ theme }) => theme.color.border};
  background: ${({ theme }) => theme.color.panel};
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
      <Left>
        {collections.collections.map((name) => (
          <CollectionItem
            key={name}
            type="button"
            $active={selected === name}
            onClick={() => setSelected(name)}
          >
            {name}
          </CollectionItem>
        ))}
        {collections.collections.length === 0 && !collections.loading && collections.error === null && (
          <Notice>컬렉션 없음</Notice>
        )}
      </Left>
      <Right>
        <Toolbar>
          <FilterInput
            aria-label="filter"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <RunButton type="button" disabled={selected === null} onClick={handleRun}>
            Run
          </RunButton>
        </Toolbar>
        {collections.error !== null && <Banner>{collections.error}</Banner>}
        {data.error !== null && <Banner>{data.error}</Banner>}
        {selected === null ? (
          <Notice>컬렉션을 선택하세요.</Notice>
        ) : data.rows.length === 0 && !data.loading ? (
          <Notice>결과 없음</Notice>
        ) : (
          <Results>
            {data.rows.map((row, i) => {
              const cell = row[0]
              const text = cell !== undefined && cell.t === 'json' ? prettify(cell.v) : ''
              // 문서 순서만 있고 안정적 id가 없다(find 결과는 정렬 미보장) — index를 key로 쓴다.
              return <Doc key={i}>{text}</Doc>
            })}
            {data.hasMore && (
              <RunButton type="button" onClick={() => void data.loadMore()}>
                Load more
              </RunButton>
            )}
          </Results>
        )}
      </Right>
    </Layout>
  )
}
