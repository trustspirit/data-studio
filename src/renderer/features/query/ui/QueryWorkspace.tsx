import styled from 'styled-components'
import type { OperationGateway } from '../../../gateways/ports/OperationGateway'
import { Button } from '../../../shared/ui'
import { useQueryRunner } from '../model/useQueryRunner'
import { SqlEditor } from './SqlEditor'
import { ResultArea } from './ResultArea'

const Layout = styled.div`
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: ${({ theme }) => theme.color.winBg};
  color: ${({ theme }) => theme.color.text};
`
const Bar = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  border-bottom: 1px solid ${({ theme }) => theme.color.borderSoft};
  font: ${({ theme }) => theme.font.ui};
`
const Title = styled.div`
  flex: 1;
  color: ${({ theme }) => theme.color.textDim};
`
const EditorPane = styled.div`
  padding: 8px;
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
      <Bar>
        <Title>Query — {connectionName}</Title>
        {q.running ? (
          <Button variant="secondary" onClick={q.cancel}>
            Cancel
          </Button>
        ) : (
          <Button onClick={() => void q.run()}>Run</Button>
        )}
      </Bar>
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
