import styled from 'styled-components'
import type { EngineId } from '@shared/types/connection'
import type { OperationGateway } from '../../../gateways/ports/OperationGateway'
import { Button, Toolbar } from '../../../shared/ui'
import { useQueryRunner } from '../model/useQueryRunner'
import { useSqlSchema } from '../model/useSqlSchema'
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
// 에디터/결과를 고정 비율로 분할한다 — 에디터는 항상 작업 가능한 높이를
// 갖고, 긴 SQL은 에디터 내부에서 스크롤되며, 결과 그리드가 화면에 남는다.
const EditorPane = styled.div`
  flex: 0 0 38%;
  min-height: 140px;
  display: flex;
  flex-direction: column;
  padding: ${({ theme }) => theme.space.sm};
`

interface Props {
  gateway: OperationGateway
  connectionId: string
  connectionName: string
  /** SQL 방언·자동완성 선택용. 미지정이면 표준 SQL + 키워드 완성만 동작. */
  engine?: EngineId | undefined
}

export function QueryWorkspace({ gateway, connectionId, connectionName, engine }: Props) {
  const q = useQueryRunner(gateway, connectionId)
  // 스키마/테이블 자동완성 — engine이 명시된 실사용 경로에서만 조회한다.
  const completion = useSqlSchema(gateway, connectionId, engine !== undefined)
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
        <SqlEditor
          value={q.sql}
          onChange={q.setSql}
          onRun={() => void q.run()}
          engine={engine}
          namespace={completion.namespace}
          defaultSchema={completion.defaultSchema}
        />
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
