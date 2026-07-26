import { useCallback, useState } from 'react'
import styled from 'styled-components'
import type { OperationGateway } from '../gateways/ports/OperationGateway'
import type { AiGateway } from '../gateways/ports/AiGateway'
import type { AiAccountStatus } from '../gateways/ports/ConnectionGateway'
import type { Capability } from '../../shared/types/capability'
import type { EngineId } from '../../shared/types/connection'
import { DocumentTabBar, canOpen, documentKey, documentTitle, showsTabBar, type Document } from '../entities/document'
import { ConfirmDialog } from '../shared/ui'
import type { TabSet } from './model/useDocumentTabs'
import { DocumentHost } from './DocumentHost'

const Layout = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  position: relative;
`
const StatusBar = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.space.md};
  padding: 0 ${({ theme }) => theme.space.md};
  height: 22px;
  border-top: 1px solid ${({ theme }) => theme.color.border};
  background: ${({ theme }) => theme.color.titlebar};
  color: ${({ theme }) => theme.color.textDim};
  font-family: ${({ theme }) => theme.font.ui};
  font-size: ${({ theme }) => theme.fontSize.xs};
`
const StatusDot = styled.span`
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: ${({ theme }) => theme.color.green};
`
const StatusRight = styled.span`
  margin-left: auto;
  color: ${({ theme }) => theme.color.textFaint};
`
const AiAccountBadge = styled.span<{ $tone: 'ok' | 'warn' }>`
  color: ${({ theme, $tone }) => ($tone === 'ok' ? theme.color.green : theme.color.orange)};
`

interface ConnectionWorkspaceProps {
  gateway: OperationGateway
  /** 없으면 AI 인스펙터 섹션이 표시되지 않는다(테스트·부분 조립 허용). */
  ai?: AiGateway | undefined
  connectionId: string
  connectionName: string
  capabilities: readonly Capability[]
  /** 쿼리 에디터의 SQL 방언·자동완성, DDL 방언 선택용. */
  engine?: EngineId | undefined
  /** AI 읽기 전용 계정의 연결 결과. 없으면 표시하지 않는다. */
  aiAccount?: AiAccountStatus | undefined
  /** 테이블 디자이너의 스키마 자동완성 목록. */
  schemas?: readonly string[] | undefined
  /** DDL로 서버 스키마가 바뀌었다 — 셸이 트리를 다시 읽어야 한다. */
  onSchemaChanged?: (() => void) | undefined
  /** 셸이 소유하는 이 연결의 탭 세트. */
  tabs: TabSet
  onOpenDocument: (doc: Document) => void
  onCloseDocument: (key: string) => void
  onActivateDocument: (key: string) => void
  /** 새 쿼리 문서의 번호를 셸에서 받아 온다. */
  onNewQuery: () => void
}

export function ConnectionWorkspace({
  gateway,
  ai,
  connectionId,
  connectionName,
  capabilities,
  engine,
  aiAccount,
  schemas = [],
  onSchemaChanged,
  tabs,
  onOpenDocument,
  onCloseDocument,
  onActivateDocument,
  onNewQuery,
}: ConnectionWorkspaceProps) {
  const activeDoc = tabs.documents.find((d) => documentKey(d) === tabs.activeKey)

  /** 지금 스테이징된 편집을 가진 문서 키의 집합. 문서별로 독립적으로 채워진다 —
   * 탭 A의 편집이 탭 B의 닫기 여부에 영향을 줘서는 안 된다. */
  const [dirtyKeys, setDirtyKeys] = useState<ReadonlySet<string>>(new Set())
  /** 확인을 기다리는 중인 닫기 요청의 문서 키. 없으면 다이얼로그를 띄우지 않는다. */
  const [pendingClose, setPendingClose] = useState<string | null>(null)

  // setDirtyKeys의 함수형 업데이트만 쓰므로 deps가 없다 — DocumentHost가 문서
  // 키별로 이 콜백을 캐싱해 재사용해도(참조가 이거 하나로 고정) 항상 최신
  // setState를 가리킨다.
  const noteDirty = useCallback((key: string, dirty: boolean) => {
    setDirtyKeys((cur) => {
      if (cur.has(key) === dirty) return cur
      const next = new Set(cur)
      if (dirty) next.add(key)
      else next.delete(key)
      return next
    })
  }, [])

  const requestClose = (key: string) => {
    if (dirtyKeys.has(key)) {
      setPendingClose(key)
      return
    }
    onCloseDocument(key)
  }

  return (
    <Layout>
      {showsTabBar(capabilities) && (
        <DocumentTabBar
          documents={tabs.documents}
          activeKey={tabs.activeKey}
          onActivate={onActivateDocument}
          onClose={requestClose}
          {...(canOpen('query', capabilities) ? { onNewQuery } : {})}
        />
      )}
      <DocumentHost
        documents={tabs.documents}
        activeKey={tabs.activeKey}
        gateway={gateway}
        ai={ai}
        connectionId={connectionId}
        engine={engine}
        schemas={schemas}
        onSchemaChanged={onSchemaChanged}
        onOpenDocument={onOpenDocument}
        onDirtyChange={noteDirty}
      />
      {pendingClose !== null && (
        <ConfirmDialog
          title="적용하지 않은 편집이 있습니다"
          message="이 탭을 닫으면 스테이징된 변경이 사라집니다."
          confirmLabel="버리고 닫기"
          testId="confirm-close-doc"
          onCancel={() => setPendingClose(null)}
          onConfirm={() => {
            const key = pendingClose
            setPendingClose(null)
            setDirtyKeys((cur) => {
              const next = new Set(cur)
              next.delete(key)
              return next
            })
            onCloseDocument(key)
          }}
        />
      )}
      <StatusBar>
        <StatusDot aria-hidden />
        <span>{connectionName}</span>
        {activeDoc !== undefined && <span>{documentTitle(activeDoc)}</span>}
        {aiAccount === 'ready' && (
          <AiAccountBadge $tone="ok" data-testid="ai-account-status">
            AI: 전용 읽기 계정
          </AiAccountBadge>
        )}
        {aiAccount === 'failed' && (
          <AiAccountBadge $tone="warn" data-testid="ai-account-status">
            AI 계정 연결 실패 — 사용자 계정 공유
          </AiAccountBadge>
        )}
        <StatusRight>{capabilities.join(' · ')}</StatusRight>
      </StatusBar>
    </Layout>
  )
}
