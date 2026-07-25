import { useCallback, useEffect, useRef, useState } from 'react'
import type { AiGateway, AiProposal } from '../../../gateways/ports/AiGateway'
import type { OperationGateway } from '../../../gateways/ports/OperationGateway'
import { failureText } from '../../../shared/lib'

export interface AiProposalsState {
  readonly proposals: readonly AiProposal[]
  readonly busyId: string | null
  readonly error: string | null
  /** 승인 결과 알림(성공 시 affected 행 수 등 요약). */
  readonly lastOutcome: string | null
  refresh: () => Promise<void>
  approve: (proposal: AiProposal) => Promise<void>
  reject: (proposal: AiProposal) => Promise<void>
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : 'unknown error'
}

/**
 * 승인 대기 중인 AI 쓰기 제안 목록과 승인/거부 동작.
 *
 * 승인은 `operation:run` + `proposalId` 경로다 — 문장 원문은 main이 보관한
 * 것으로 실행되며, 여기서 보내는 sql은 표시용 사본일 뿐 실행에 쓰이지 않는다.
 */
export function useAiProposals(
  ai: AiGateway,
  operation: OperationGateway,
  connectionId: string,
  refreshSignal: number,
): AiProposalsState {
  const [proposals, setProposals] = useState<readonly AiProposal[]>([])
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [lastOutcome, setLastOutcome] = useState<string | null>(null)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const refresh = useCallback(async () => {
    try {
      const list = await ai.proposals(connectionId)
      if (mounted.current) setProposals(list)
    } catch (e) {
      if (mounted.current) setError(messageOf(e))
    }
  }, [ai, connectionId])

  useEffect(() => {
    void refresh()
  }, [refresh, refreshSignal])

  const approve = useCallback(
    async (proposal: AiProposal) => {
      if (busyId !== null) return
      setBusyId(proposal.proposalId)
      setError(null)
      setLastOutcome(null)
      try {
        const outcome = await operation.run({
          requestId: crypto.randomUUID(),
          connectionId,
          // 실행은 main 보관 원문으로 대체된다. 여기 sql은 스키마를 채우는 표시용.
          operation: { kind: 'sql', sql: proposal.statement },
          proposalId: proposal.proposalId,
        })
        if (!mounted.current) return
        if (outcome.ok) {
          setLastOutcome(
            outcome.payload.kind === 'rows'
              ? `실행됨 — ${outcome.payload.rows.meta.rowsAffected ?? 0} rows affected`
              : '실행됨',
          )
        } else {
          setError(failureText(outcome))
        }
      } catch (e) {
        if (mounted.current) setError(messageOf(e))
      } finally {
        if (mounted.current) {
          setBusyId(null)
          await refresh()
        }
      }
    },
    [operation, connectionId, busyId, refresh],
  )

  const reject = useCallback(
    async (proposal: AiProposal) => {
      if (busyId !== null) return
      setBusyId(proposal.proposalId)
      setError(null)
      try {
        await ai.rejectProposal(proposal.proposalId, connectionId)
      } catch (e) {
        if (mounted.current) setError(messageOf(e))
      } finally {
        if (mounted.current) {
          setBusyId(null)
          await refresh()
        }
      }
    },
    [ai, connectionId, busyId, refresh],
  )

  return { proposals, busyId, error, lastOutcome, refresh, approve, reject }
}
