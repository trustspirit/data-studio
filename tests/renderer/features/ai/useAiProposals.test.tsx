// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useAiProposals } from '@renderer/features/ai/model/useAiProposals'
import type { AiGateway, AiProposal } from '@renderer/gateways/ports/AiGateway'
import type { OperationGateway } from '@renderer/gateways/ports/OperationGateway'

const PROPOSAL: AiProposal = {
  proposalId: 'p1',
  connectionId: 'c1',
  statement: 'DELETE FROM users WHERE id = 1',
  statementHash: 'h1',
  kind: 'write',
  impact: { summary: 'DELETE on users', estimatedRows: 1 },
  expiresAt: 99_999,
}

function fakes(proposalsReturn: AiProposal[] = [PROPOSAL]) {
  const proposals = vi.fn().mockResolvedValue(proposalsReturn)
  const rejectProposal = vi.fn().mockResolvedValue(true)
  const run = vi.fn().mockResolvedValue({
    ok: true,
    payload: { kind: 'rows', rows: { meta: { rowsAffected: 1 } } },
  })
  const ai = { proposals, rejectProposal } as unknown as AiGateway
  const operation = { run } as unknown as OperationGateway
  return { ai, operation, proposals, rejectProposal, run }
}

describe('useAiProposals', () => {
  it('마운트 시 그 커넥션의 제안 목록을 불러온다', async () => {
    const { ai, operation, proposals } = fakes()
    const { result } = renderHook(() => useAiProposals(ai, operation, 'c1', 0))

    await waitFor(() => expect(result.current.proposals).toHaveLength(1))
    expect(proposals).toHaveBeenCalledWith('c1')
  })

  it('refreshSignal이 바뀌면 다시 불러온다', async () => {
    const { ai, operation, proposals } = fakes()
    const { rerender } = renderHook(({ sig }) => useAiProposals(ai, operation, 'c1', sig), {
      initialProps: { sig: 0 },
    })

    await waitFor(() => expect(proposals).toHaveBeenCalledTimes(1))
    rerender({ sig: 1 })
    await waitFor(() => expect(proposals).toHaveBeenCalledTimes(2))
  })

  it('approve는 proposalId를 실은 operation:run으로 나가고 목록을 갱신한다', async () => {
    const { ai, operation, proposals, run } = fakes()
    const { result } = renderHook(() => useAiProposals(ai, operation, 'c1', 0))
    await waitFor(() => expect(result.current.proposals).toHaveLength(1))

    await act(async () => {
      await result.current.approve(PROPOSAL)
    })

    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionId: 'c1',
        proposalId: 'p1',
        operation: { kind: 'sql', sql: PROPOSAL.statement },
      }),
    )
    expect(result.current.lastOutcome).toContain('1 rows affected')
    // approve 후 refresh — 최초 1 + approve 후 1
    expect(proposals).toHaveBeenCalledTimes(2)
  })

  it('approve 실패(도메인 거부)는 오류로 남는다', async () => {
    const { ai, operation, run } = fakes()
    run.mockResolvedValue({ ok: false, reason: 'proposal_invalid' })
    const { result } = renderHook(() => useAiProposals(ai, operation, 'c1', 0))
    await waitFor(() => expect(result.current.proposals).toHaveLength(1))

    await act(async () => {
      await result.current.approve(PROPOSAL)
    })

    expect(result.current.error).toBe('proposal_invalid')
  })

  it('reject는 게이트웨이로 나가고 목록을 갱신한다', async () => {
    const { ai, operation, proposals, rejectProposal } = fakes()
    const { result } = renderHook(() => useAiProposals(ai, operation, 'c1', 0))
    await waitFor(() => expect(result.current.proposals).toHaveLength(1))

    await act(async () => {
      await result.current.reject(PROPOSAL)
    })

    expect(rejectProposal).toHaveBeenCalledWith('p1', 'c1')
    expect(proposals).toHaveBeenCalledTimes(2)
  })
})
