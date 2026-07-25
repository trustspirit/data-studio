import styled from 'styled-components'
import type { OperationGateway } from '../../../gateways/ports/OperationGateway'
import { Button, Toolbar } from '../../../shared/ui'
import { useQueryRunner } from '../model/useQueryRunner'
import { SqlEditor } from './SqlEditor'
import { ResultArea } from './ResultArea'

const Layout = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: ${({ theme }) => theme.color.winBg};
  color: ${({ theme }) => theme.color.text};
`
const Title = styled.div`
  flex: 1;
  color: ${({ theme }) => theme.color.textDim};
`
// 에디터가 결과 영역을 밀어내지 못하게 높이를 제한한다 — 긴 SQL은
// 에디터 내부에서 스크롤되고, 결과 그리드가 항상 화면에 남는다.
const EditorPane = styled.div`
  flex: 0 0 auto;
  max-height: 40%;
  overflow: auto;
  padding: ${({ theme }) => theme.space.sm};
`

interface Props {
  gateway: OperationGateway
  connectionId: string
  connectionName: string
}

export function QueryWorkspace({ gateway, connectionId, connectionName }: Props) {
  const q = useQueryRunner(gateway, connectionId)
  return (
    <Layout>
      <Toolbar>
        <Title>Query — {connectionName}</Title>
        {q.running ? (
          <Button variant="secondary" size="sm" onClick={q.cancel}>
            Cancel
          </Button>
        ) : (
          <Button size="sm" onClick={() => void q.run()}>
            Run
          </Button>
        )}
      </Toolbar>
      <EditorPane>
        <SqlEditor value={q.sql} onChange={q.setSql} onRun={() => void q.run()} />
      </EditorPane>
      <ResultArea
        columns={q.columns}
        rows={q.rows}
        rowsAffected={q.rowsAffected}
        notices={q.notices}
        error={q.error}
        hasMore={q.hasMore}
        onLoadMore={() => void q.loadMore()}
      />
    </Layout>
  )
}
