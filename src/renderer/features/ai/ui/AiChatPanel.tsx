import { useEffect, useRef, useState } from 'react'
import styled from 'styled-components'
import type { AiGateway, AiProposal, AiProviderId } from '../../../gateways/ports/AiGateway'
import type { OperationGateway } from '../../../gateways/ports/OperationGateway'
import { Button, ErrorBanner, NativeSelect, Input } from '../../../shared/ui'
import { useAiChat } from '../model/useAiChat'
import { useAiKeys } from '../model/useAiKeys'
import { useAiProposals } from '../model/useAiProposals'

const Panel = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  border-left: 1px solid ${({ theme }) => theme.color.border};
  background: ${({ theme }) => theme.color.sidebar};
  font-family: ${({ theme }) => theme.font.ui};
`
const Header = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.space.sm};
  padding: ${({ theme }) => `${theme.space.xs} ${theme.space.sm}`};
  border-bottom: 1px solid ${({ theme }) => theme.color.border};
  background: ${({ theme }) => theme.color.toolbar};
`
const Title = styled.span`
  font-size: ${({ theme }) => theme.fontSize.sm};
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: ${({ theme }) => theme.color.textDim};
  margin-right: auto;
`
const Messages = styled.div`
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: ${({ theme }) => theme.space.sm};
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.space.sm};
`
const UserMsg = styled.div`
  align-self: flex-end;
  max-width: 90%;
  padding: ${({ theme }) => `${theme.space.xs} ${theme.space.sm}`};
  border-radius: ${({ theme }) => theme.radius.lg};
  background: ${({ theme }) => theme.color.panel};
  border: 1px solid ${({ theme }) => theme.color.borderSoft};
  color: ${({ theme }) => theme.color.text};
  font-size: ${({ theme }) => theme.fontSize.md};
  white-space: pre-wrap;
  word-break: break-word;
`
const AssistantMsg = styled.div`
  align-self: stretch;
  color: ${({ theme }) => theme.color.text};
  font-size: ${({ theme }) => theme.fontSize.md};
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
`
const ToolChips = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${({ theme }) => theme.space.xs};
  margin-bottom: ${({ theme }) => theme.space.xs};
`
const ToolChip = styled.span`
  font-family: ${({ theme }) => theme.font.mono};
  font-size: ${({ theme }) => theme.fontSize.xs};
  color: ${({ theme }) => theme.color.teal};
  border: 1px solid ${({ theme }) => theme.color.borderSoft};
  border-radius: 999px;
  padding: 1px 8px;
`
const StreamDot = styled.span`
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: ${({ theme }) => theme.color.accent};
  animation: aiPulse 1s ease-in-out infinite;
  @keyframes aiPulse {
    50% {
      opacity: 0.25;
    }
  }
`
const ProposalCard = styled.div`
  margin: 0 ${({ theme }) => theme.space.sm} ${({ theme }) => theme.space.sm};
  border: 1px solid ${({ theme }) => theme.color.orange};
  border-radius: ${({ theme }) => theme.radius.md};
  background: ${({ theme }) => theme.color.panel};
  overflow: hidden;
`
const ProposalHead = styled.div`
  padding: ${({ theme }) => `${theme.space.xs} ${theme.space.sm}`};
  font-size: ${({ theme }) => theme.fontSize.xs};
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: ${({ theme }) => theme.color.orange};
`
const ProposalSql = styled.pre`
  margin: 0;
  padding: ${({ theme }) => `${theme.space.xs} ${theme.space.sm}`};
  font-family: ${({ theme }) => theme.font.mono};
  font-size: ${({ theme }) => theme.fontSize.sm};
  color: ${({ theme }) => theme.color.text};
  background: ${({ theme }) => theme.color.gridBg};
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 140px;
  overflow-y: auto;
`
const ProposalMeta = styled.div`
  padding: ${({ theme }) => `${theme.space.xs} ${theme.space.sm}`};
  font-size: ${({ theme }) => theme.fontSize.xs};
  color: ${({ theme }) => theme.color.textDim};
`
const ProposalActions = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: ${({ theme }) => theme.space.xs};
  padding: ${({ theme }) => theme.space.xs} ${({ theme }) => theme.space.sm};
  border-top: 1px solid ${({ theme }) => theme.color.borderSoft};
`
const OutcomeNote = styled.div`
  margin: 0 ${({ theme }) => theme.space.sm} ${({ theme }) => theme.space.xs};
  font-size: ${({ theme }) => theme.fontSize.xs};
  color: ${({ theme }) => theme.color.green};
`
const InputRow = styled.div`
  display: flex;
  align-items: flex-end;
  gap: ${({ theme }) => theme.space.xs};
  padding: ${({ theme }) => theme.space.sm};
  border-top: 1px solid ${({ theme }) => theme.color.border};
`
const ChatInput = styled.textarea`
  flex: 1;
  min-width: 0;
  resize: none;
  font-family: ${({ theme }) => theme.font.ui};
  font-size: ${({ theme }) => theme.fontSize.md};
  line-height: 1.4;
  padding: 6px 8px;
  border-radius: ${({ theme }) => theme.radius.md};
  background: ${({ theme }) => theme.color.gridBg};
  color: ${({ theme }) => theme.color.text};
  border: 1px solid ${({ theme }) => theme.color.border};
`
const KeySetup = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.space.xs};
  margin: ${({ theme }) => theme.space.sm};
  padding: ${({ theme }) => theme.space.sm};
  border: 1px solid ${({ theme }) => theme.color.borderSoft};
  border-radius: ${({ theme }) => theme.radius.md};
  background: ${({ theme }) => theme.color.panel};
  font-size: ${({ theme }) => theme.fontSize.sm};
  color: ${({ theme }) => theme.color.textDim};
`
const KeyRow = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.space.xs};
`
const Hint = styled.div`
  padding: ${({ theme }) => theme.space.lg};
  color: ${({ theme }) => theme.color.textFaint};
  font-size: ${({ theme }) => theme.fontSize.sm};
  text-align: center;
`

const PROVIDER_LABEL: Record<AiProviderId, string> = {
  anthropic: 'Claude (Anthropic)',
  openai: 'GPT (OpenAI)',
}

interface AiChatPanelProps {
  ai: AiGateway
  operation: OperationGateway
  connectionId: string
}

/**
 * 우측 AI 어시스턴트 패널. 채팅·쓰기 제안 승인·API 키 등록을 담는다.
 *
 * 쓰기 제안 카드의 Approve는 `operation:run` + `proposalId`로 나간다 —
 * 실행 문장은 main이 보관한 원문이며, 이 패널은 표시만 한다.
 */
export function AiChatPanel({ ai, operation, connectionId }: AiChatPanelProps) {
  const chat = useAiChat(ai)
  const keys = useAiKeys(ai)
  const proposals = useAiProposals(ai, operation, connectionId, chat.proposalSignal)
  const [draft, setDraft] = useState('')
  const [keyDraft, setKeyDraft] = useState('')
  const endRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    // jsdom에는 scrollIntoView가 없다 — 있을 때만 부른다.
    endRef.current?.scrollIntoView?.({ block: 'end' })
  }, [chat.items, proposals.proposals.length])

  const hasKey = keys.status === null ? true : keys.status[chat.provider]

  const submit = () => {
    if (chat.streaming || draft.trim() === '') return
    void chat.send(draft)
    setDraft('')
  }

  return (
    <Panel data-testid="ai-chat-panel">
      <Header>
        <Title>Assistant</Title>
        <NativeSelect
          aria-label="AI provider"
          value={chat.provider}
          onChange={(e) => chat.setProvider(e.target.value as AiProviderId)}
        >
          {(Object.keys(PROVIDER_LABEL) as AiProviderId[]).map((p) => (
            <option key={p} value={p}>
              {PROVIDER_LABEL[p]}
            </option>
          ))}
        </NativeSelect>
        {keys.status?.[chat.provider] === true && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void keys.removeKey(chat.provider)}
            title="저장된 API 키 삭제"
          >
            키 삭제
          </Button>
        )}
      </Header>

      {!hasKey && (
        <KeySetup>
          <span>{PROVIDER_LABEL[chat.provider]} API 키가 필요합니다. 키는 OS 암호화로 저장됩니다.</span>
          <KeyRow>
            <Input
              type="password"
              aria-label="API key"
              placeholder="sk-..."
              value={keyDraft}
              onChange={(e) => setKeyDraft(e.target.value)}
            />
            <Button
              size="sm"
              disabled={keyDraft.trim() === ''}
              onClick={() => {
                void keys.saveKey(chat.provider, keyDraft)
                setKeyDraft('')
              }}
            >
              저장
            </Button>
          </KeyRow>
        </KeySetup>
      )}

      <Messages>
        {chat.items.length === 0 && (
          <Hint>
            연결된 데이터베이스에 대해 물어보세요.
            <br />
            읽기는 자동, 쓰기는 항상 승인 후 실행됩니다.
          </Hint>
        )}
        {chat.items.map((item, i) =>
          item.role === 'user' ? (
            <UserMsg key={i}>{item.text}</UserMsg>
          ) : (
            <AssistantMsg key={i}>
              {item.tools.length > 0 && (
                <ToolChips>
                  {item.tools.map((t, j) => (
                    <ToolChip key={j}>{t}</ToolChip>
                  ))}
                </ToolChips>
              )}
              {item.text}
              {chat.streaming && i === chat.items.length - 1 && <StreamDot aria-hidden />}
            </AssistantMsg>
          ),
        )}
        <div ref={endRef} />
      </Messages>

      {proposals.lastOutcome !== null && <OutcomeNote>{proposals.lastOutcome}</OutcomeNote>}
      {proposals.proposals.map((p: AiProposal) => (
        <ProposalCard key={p.proposalId} data-testid={`proposal-${p.proposalId}`}>
          <ProposalHead>쓰기 승인 대기</ProposalHead>
          <ProposalSql>{p.statement}</ProposalSql>
          <ProposalMeta>
            {p.impact.summary}
            {p.impact.estimatedRows !== null && ` · ~${p.impact.estimatedRows} rows`}
          </ProposalMeta>
          <ProposalActions>
            <Button
              size="sm"
              variant="secondary"
              disabled={proposals.busyId !== null}
              onClick={() => void proposals.reject(p)}
            >
              거부
            </Button>
            <Button
              size="sm"
              variant="danger"
              disabled={proposals.busyId !== null}
              onClick={() => void proposals.approve(p)}
            >
              승인 · 실행
            </Button>
          </ProposalActions>
        </ProposalCard>
      ))}

      {chat.error !== null && <ErrorBanner>{chat.error}</ErrorBanner>}
      {proposals.error !== null && <ErrorBanner>{proposals.error}</ErrorBanner>}
      {keys.error !== null && <ErrorBanner>{keys.error}</ErrorBanner>}

      <InputRow>
        <ChatInput
          aria-label="AI에게 보낼 메시지"
          rows={2}
          placeholder={hasKey ? '메시지 입력 — Enter로 전송' : 'API 키를 먼저 등록하세요'}
          value={draft}
          disabled={!hasKey}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              submit()
            }
          }}
        />
        {chat.streaming ? (
          <Button size="sm" variant="secondary" onClick={chat.cancel}>
            중지
          </Button>
        ) : (
          <Button size="sm" disabled={!hasKey || draft.trim() === ''} onClick={submit}>
            전송
          </Button>
        )}
      </InputRow>
    </Panel>
  )
}
