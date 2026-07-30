import styled from 'styled-components'
import { Icon, TabStrip, type TabDescriptor } from '../../../shared/ui'
import { documentKey, documentTitle, type Document } from '../model/document'

const NewQuery = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 ${({ theme }) => theme.space.sm};
  border: none;
  border-radius: ${({ theme }) => theme.radius.md};
  cursor: pointer;
  color: ${({ theme }) => theme.color.text.dim};
  background: transparent;
  &:hover {
    color: ${({ theme }) => theme.color.text.primary};
  }
`

interface DocumentTabBarProps {
  documents: readonly Document[]
  activeKey: string | null
  onActivate: (key: string) => void
  onClose: (key: string) => void
  /** SQL 연결에서만 넘어온다 — 없으면 버튼이 아예 나오지 않는다. */
  onNewQuery?: (() => void) | undefined
}

export function DocumentTabBar({ documents, activeKey, onActivate, onClose, onNewQuery }: DocumentTabBarProps) {
  const tabs: TabDescriptor[] = documents.map((doc) => ({ key: documentKey(doc), title: documentTitle(doc) }))

  return (
    <TabStrip
      tabs={tabs}
      activeKey={activeKey}
      onActivate={onActivate}
      onClose={onClose}
      label="문서 탭"
      testIdPrefix="doctab"
      {...(onNewQuery !== undefined
        ? {
            trailing: (
              <NewQuery type="button" data-testid="doctab-new-query" aria-label="새 쿼리" onClick={onNewQuery}>
                <Icon name="plus" size="lg" />
              </NewQuery>
            ),
          }
        : {})}
    />
  )
}
