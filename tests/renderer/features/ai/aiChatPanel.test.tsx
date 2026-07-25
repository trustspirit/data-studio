// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { ThemeProvider, darkTheme } from '@renderer/shared/theme'
import { AiChatPanel } from '@renderer/features/ai'
import type { AiGateway, AiProposal } from '@renderer/gateways/ports/AiGateway'
import type { OperationGateway } from '@renderer/gateways/ports/OperationGateway'
import type { AiStreamEvent } from '@shared/contracts/aiEvents'

const PROPOSAL: AiProposal = {
  proposalId: 'p1',
  connectionId: 'c1',
  statement: 'UPDATE users SET name = $1',
  statementHash: 'h1',
  kind: 'write',
  impact: { summary: 'UPDATE on users', estimatedRows: 3 },
  expiresAt: 99_999,
}

function fakeAi(over: Partial<AiGateway> = {}) {
  let listener: ((e: AiStreamEvent) => void) | null = null
  const send = vi.fn().mockResolvedValue({ accepted: true })
  const setKey = vi.fn().mockResolvedValue(undefined)
  const rejectProposal = vi.fn().mockResolvedValue(true)
  const gw: AiGateway = {
    newSession: vi.fn().mockResolvedValue({ chatId: 'chat-1' }),
    send,
    cancel: vi.fn().mockResolvedValue(undefined),
    keyStatus: vi.fn().mockResolvedValue({ anthropic: true, openai: false }),
    setKey,
    deleteKey: vi.fn().mockResolvedValue(undefined),
    proposals: vi.fn().mockResolvedValue([]),
    rejectProposal,
    onEvent: (_id: string, l: (e: AiStreamEvent) => void) => {
      listener = l
      return vi.fn()
    },
    ...over,
  }
  return { gw, send, setKey, rejectProposal, emit: (e: AiStreamEvent) => listener?.(e) }
}

const run = vi.fn().mockResolvedValue({
  ok: true,
  payload: { kind: 'rows', rows: { meta: { rowsAffected: 3 } } },
})
const operation = { run } as unknown as OperationGateway

function renderPanel(ai: AiGateway) {
  return render(
    <ThemeProvider theme={darkTheme}>
      <AiChatPanel ai={ai} operation={operation} connectionId="c1" />
    </ThemeProvider>,
  )
}

describe('AiChatPanel', () => {
  it('키가 있으면 입력이 활성화되고 Enter로 전송된다', async () => {
    const { gw, send } = fakeAi()
    renderPanel(gw)

    const input = await screen.findByLabelText<HTMLTextAreaElement>('AI에게 보낼 메시지')
    await waitFor(() => expect(input.disabled).toBe(false))

    fireEvent.change(input, { target: { value: 'show tables' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => expect(send).toHaveBeenCalledWith('chat-1', 'show tables'))
    expect(screen.getByText('show tables')).toBeDefined()
  })

  it('선택된 프로바이더의 키가 없으면 키 등록 폼을 보여준다', async () => {
    const { gw, setKey } = fakeAi({
      keyStatus: vi.fn().mockResolvedValue({ anthropic: false, openai: false }),
    })
    renderPanel(gw)

    const keyInput = await screen.findByLabelText('API key')
    fireEvent.change(keyInput, { target: { value: 'sk-test' } })
    fireEvent.click(screen.getByText('저장'))

    await waitFor(() => expect(setKey).toHaveBeenCalledWith('anthropic', 'sk-test'))
  })

  it('스트림 텍스트가 화면에 나타난다', async () => {
    const { gw, send, emit } = fakeAi()
    renderPanel(gw)

    const input = await screen.findByLabelText<HTMLTextAreaElement>('AI에게 보낼 메시지')
    await waitFor(() => expect(input.disabled).toBe(false))
    fireEvent.change(input, { target: { value: 'hi' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(send).toHaveBeenCalled())

    act(() => {
      emit({ type: 'text', delta: 'there are 3 tables' })
      emit({ type: 'done' })
    })

    expect(await screen.findByText('there are 3 tables')).toBeDefined()
  })

  it('승인 대기 제안 카드를 그리고 승인이 operation:run으로 나간다', async () => {
    const { gw } = fakeAi({ proposals: vi.fn().mockResolvedValue([PROPOSAL]) })
    renderPanel(gw)

    expect(await screen.findByText('UPDATE users SET name = $1')).toBeDefined()
    fireEvent.click(screen.getByText('승인 · 실행'))

    await waitFor(() =>
      expect(run).toHaveBeenCalledWith(expect.objectContaining({ proposalId: 'p1' })),
    )
  })

  it('거부 버튼이 rejectProposal로 나간다', async () => {
    const { gw, rejectProposal } = fakeAi({ proposals: vi.fn().mockResolvedValue([PROPOSAL]) })
    renderPanel(gw)

    await screen.findByText('UPDATE users SET name = $1')
    fireEvent.click(screen.getByText('거부'))

    await waitFor(() => expect(rejectProposal).toHaveBeenCalledWith('p1', 'c1'))
  })
})
