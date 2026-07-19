import type { DenialReason } from './ExecutionPolicy'

/**
 * 감사 로그에 남는 결과.
 *
 * 실행 결과(`allowed`/`denied`/`failed`)와 쓰기 제안서의 수명주기
 * (`proposed`/`approved`/`rejected`/`expired`)를 한 흐름에 담는다. 스펙 §4.3은
 * 승인·거부·만료를 전부 기록하라고 요구하는데, 이를 별도 저장소로 나누면
 * "AI가 무엇을 제안했고 사용자가 무엇을 승인했으며 그래서 무엇이 실행됐는가"를
 * 재구성하려고 두 로그를 시각으로 꿰맞춰야 한다.
 */
export type OperationOutcome =
  | 'allowed'
  | 'denied'
  | 'failed'
  | 'proposed'
  | 'approved'
  | 'rejected'
  | 'expired'

export interface OperationLogEntry {
  readonly requestId: string
  readonly connectionId: string
  readonly actorType: 'user' | 'ai'
  /** AI 세션 id. 사용자 경로는 null이다 — 자격증명은 절대 기록하지 않는다. */
  readonly actorId: string | null
  /** 원문 그대로. 자르거나 정규화하지 않는다. */
  readonly statement: string
  readonly outcome: OperationOutcome
  readonly denialReason?: DenialReason
  readonly errorMessage?: string
  /**
   * 제안서의 `statementHash`. 제안 → 승인 → 실행이 서로 다른 항목으로 남으므로,
   * 이 값이 있어야 "사용자가 승인한 그 문장이 실행됐다"를 로그만 보고 대조할 수
   * 있다.
   */
  readonly statementHash?: string
  readonly durationMs: number
  readonly at: number
}

export type OperationLogInput = Omit<OperationLogEntry, 'at'>

/**
 * 감사 로그 포트. 스펙 §4.2 6층.
 *
 * 거부와 실패도 기록한다 — 성공만 남기면 AI가 무엇을 시도했는지 알 수 없고,
 * 감사 로그의 목적이 사라진다.
 */
export interface OperationLog {
  record(entry: OperationLogInput): void
  /** 최신순으로 최대 `limit`개. */
  recent(limit: number): readonly OperationLogEntry[]
}
