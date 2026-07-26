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
/**
 * 탭 하나의 껍데기. 제목 버튼과 닫기 버튼은 **형제**다 —
 * `SchemaNavigator`의 `SchemaRow`(펼치기/ER)와 `ConnectionRow`가 같은 구조다.
 * 닫기를 제목 버튼 **안에** 넣으면 HTML이 금지하는 버튼 속의 상호작용 요소가
 * 되고(`role="tab"` 아래로는 ARIA도 금지한다), 보조 기술이 둘을 컨트롤 하나로
 * 합쳐 버려 닫기가 사라진다.
 *
 * `role="presentation"`을 주는 이유: tablist는 tab을 직접 소유해야 한다. 중간
 * 요소가 표현용임을 밝혀야 그 소유 관계가 유지된다.
 */
const TabGroup = styled.div<{ $active: boolean }>`
  display: flex;
  align-items: center;
  border-radius: ${({ theme }) => theme.radius.md};
  background: ${({ theme, $active }) => ($active ? theme.color.panel : 'transparent')};
`
const Tab = styled.button<{ $active: boolean }>`
  font-family: ${({ theme }) => theme.font.ui};
  font-size: ${({ theme }) => theme.fontSize.sm};
  padding: 4px 4px 4px 12px;
  border: none;
  border-radius: ${({ theme }) => `${theme.radius.md} 0 0 ${theme.radius.md}`};
  cursor: pointer;
  white-space: nowrap;
  background: transparent;
  color: ${({ theme, $active }) => ($active ? theme.color.text : theme.color.textDim)};
  &:hover {
    color: ${({ theme }) => theme.color.text};
  }
`
const Close = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  margin: 0 6px 0 ${({ theme }) => theme.space.xs};
  padding: 0;
  border: none;
  border-radius: ${({ theme }) => theme.radius.sm};
  cursor: pointer;
  background: transparent;
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
          <TabGroup key={key} role="presentation" $active={active}>
            <Tab
              type="button"
              role="tab"
              aria-selected={active}
              data-testid={`doctab-${key}`}
              $active={active}
              onClick={() => onActivate(key)}
            >
              {documentTitle(doc)}
            </Tab>
            <Close
              type="button"
              aria-label={`${documentTitle(doc)} 닫기`}
              data-testid={`doctab-close-${key}`}
              // 형제 버튼이라 탭 활성화로 번지지 않는다 — stopPropagation이 필요 없다.
              onClick={() => onClose(key)}
            >
              ×
            </Close>
          </TabGroup>
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
