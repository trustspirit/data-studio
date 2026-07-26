import styled from 'styled-components'
import { documentKey, documentTitle, type Document } from '../model/document'

const Bar = styled.div`
  display: flex;
  align-items: stretch;
  gap: ${({ theme }) => theme.space.xs};
  padding: ${({ theme }) => `${theme.space.xs} ${theme.space.sm}`};
  border-bottom: 1px solid ${({ theme }) => theme.color.border};
  background: ${({ theme }) => theme.color.toolbar};
  overflow-x: auto;
`
const Tab = styled.button<{ $active: boolean }>`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.space.xs};
  font-family: ${({ theme }) => theme.font.ui};
  font-size: ${({ theme }) => theme.fontSize.sm};
  padding: 4px 6px 4px 12px;
  border: none;
  border-radius: ${({ theme }) => theme.radius.md};
  cursor: pointer;
  white-space: nowrap;
  color: ${({ theme, $active }) => ($active ? theme.color.text : theme.color.textDim)};
  background: ${({ theme, $active }) => ($active ? theme.color.panel : 'transparent')};
  &:hover {
    color: ${({ theme }) => theme.color.text};
  }
`
const Close = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: ${({ theme }) => theme.radius.sm};
  color: ${({ theme }) => theme.color.textFaint};
  &:hover {
    background: ${({ theme }) => theme.color.rowHover};
    color: ${({ theme }) => theme.color.text};
  }
`
const NewQuery = styled.button`
  font-family: ${({ theme }) => theme.font.ui};
  font-size: ${({ theme }) => theme.fontSize.sm};
  padding: 4px 10px;
  border: none;
  border-radius: ${({ theme }) => theme.radius.md};
  cursor: pointer;
  color: ${({ theme }) => theme.color.textDim};
  background: transparent;
  &:hover {
    color: ${({ theme }) => theme.color.text};
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
  return (
    <Bar role="tablist">
      {documents.map((doc) => {
        const key = documentKey(doc)
        const active = key === activeKey
        return (
          <Tab
            key={key}
            type="button"
            role="tab"
            aria-selected={active}
            data-testid={`doctab-${key}`}
            $active={active}
            onClick={() => onActivate(key)}
          >
            {documentTitle(doc)}
            <Close
              role="button"
              aria-label={`${documentTitle(doc)} 닫기`}
              data-testid={`doctab-close-${key}`}
              onClick={(e) => {
                // 닫기는 탭 활성화가 아니다 — 버블링을 막지 않으면 닫으면서 활성이 된다.
                e.stopPropagation()
                onClose(key)
              }}
            >
              ×
            </Close>
          </Tab>
        )
      })}
      {onNewQuery !== undefined && (
        <NewQuery type="button" data-testid="doctab-new-query" aria-label="새 쿼리" onClick={onNewQuery}>
          ＋
        </NewQuery>
      )}
    </Bar>
  )
}
