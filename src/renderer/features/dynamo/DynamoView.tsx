import { useEffect, useState } from 'react'
import styled from 'styled-components'
import type { OperationGateway } from '../../gateways/ports/OperationGateway'
import { Button, EmptyState, ErrorBanner, ListItem, Notice, Sidebar, Toolbar } from '../../shared/ui'
import { useDynamoTables } from './model/useDynamoTables'
import { useDynamoData } from './model/useDynamoData'

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
const TableList = styled.div`
  flex: 1;
  overflow: auto;
  font-family: ${({ theme }) => theme.font.ui};
  font-size: ${({ theme }) => theme.fontSize.body};
`
const Right = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
`
const Editor = styled.textarea`
  flex: 1;
  min-width: 0;
  resize: none;
  height: 48px;
  font-family: ${({ theme }) => theme.font.mono};
  font-size: ${({ theme }) => theme.fontSize.body};
  padding: ${({ theme }) => `${theme.space.xs} ${theme.space.sm}`};
  border-radius: ${({ theme }) => theme.radius.md};
  border: 1px solid ${({ theme }) => theme.color.border.strong};
  background: ${({ theme }) => theme.color.surface.bg};
  color: ${({ theme }) => theme.color.text.primary};
`
const Rows = styled.div`
  flex: 1;
  overflow: auto;
  padding: ${({ theme }) => `${theme.space.xs} ${theme.space.md}`};
`
const ItemRow = styled.pre`
  margin: 0 0 ${({ theme }) => theme.space.xs} 0;
  padding: ${({ theme }) => `${theme.space.sm} ${theme.space.md}`};
  border-bottom: 1px solid ${({ theme }) => theme.color.border.strong};
  font-family: ${({ theme }) => theme.font.mono};
  font-size: ${({ theme }) => theme.fontSize.body};
  white-space: pre-wrap;
  word-break: break-word;
`

interface DynamoViewProps {
  gateway: OperationGateway
  connectionId: string
}

/** _item json 셀을 pretty하게. 파싱 실패 시 원문. */
function prettify(json: string): string {
  try {
    return JSON.stringify(JSON.parse(json) as unknown, null, 2)
  } catch {
    return json
  }
}

export function DynamoView({ gateway, connectionId }: DynamoViewProps) {
  const tables = useDynamoTables(gateway, connectionId)
  const data = useDynamoData(gateway, connectionId)
  const [selected, setSelected] = useState<string | null>(null)
  const [statement, setStatement] = useState('')
  const [ranOnce, setRanOnce] = useState(false)

  // 연결이 바뀌면 로컬 선택/입력을 초기화한다.
  useEffect(() => { setSelected(null); setStatement(''); setRanOnce(false) }, [connectionId])

  const selectTable = (table: string) => {
    setSelected(table)
    setRanOnce(true)
    data.runScan(table)
  }

  const runStatement = () => {
    setSelected(null)
    setRanOnce(true)
    data.runPartiql(statement)
  }

  return (
    <Layout>
      <Left>
        {tables.error !== null && <ErrorBanner>{tables.error}</ErrorBanner>}
        <TableList>
          {tables.loading && tables.tables.length === 0 && <Notice>불러오는 중…</Notice>}
          {tables.tables.map((t) => (
            <ListItem key={t} active={selected === t} onSelect={() => selectTable(t)}>
              {t}
            </ListItem>
          ))}
          {tables.hasMore && (
            <Button variant="ghost" size="sm" onClick={() => void tables.loadMore()}>Load more</Button>
          )}
        </TableList>
      </Left>
      <Right>
        <Toolbar>
          <Editor
            aria-label="partiql"
            placeholder='SELECT * FROM "table" WHERE pk = ...'
            value={statement}
            onChange={(e) => setStatement(e.target.value)}
          />
          <Button variant="ghost" size="sm" disabled={statement.trim() === ''} onClick={runStatement}>
            Run
          </Button>
        </Toolbar>
        {data.error !== null && <ErrorBanner>{data.error}</ErrorBanner>}
        {!ranOnce ? (
          <EmptyState title="테이블을 선택하세요." hint="왼쪽에서 테이블을 고르거나 PartiQL을 입력해 Run 하세요" />
        ) : (
          <Rows>
            {data.loading && data.rows.length === 0 && <Notice>불러오는 중…</Notice>}
            {!data.loading && data.rows.length === 0 && data.error === null && <Notice>결과 없음</Notice>}
            {data.rows.map((row, i) => (
              <ItemRow key={i}>{row[0]?.t === 'json' ? prettify(row[0].v) : ''}</ItemRow>
            ))}
            {data.hasMore && (
              <Button variant="ghost" size="sm" onClick={() => void data.loadMore()}>Load more</Button>
            )}
          </Rows>
        )}
      </Right>
    </Layout>
  )
}
