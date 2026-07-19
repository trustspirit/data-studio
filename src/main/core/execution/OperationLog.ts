import type { DenialReason } from './ExecutionPolicy'

/**
 * 감사 로그에 남는 결과.
 *
 * 실행 결과(`allowed`/`denied`/`failed`)와 쓰기 제안서의 수명주기
 * (`proposed`/`approved`/`rejected`/`expired`)를 한 흐름에 담는다. 스펙 §4.3은
 * 승인·거부·만료를 전부 기록하라고 요구하는데, 이를 별도 저장소로 나누면
 * "AI가 무엇을 제안했고 사용자가 무엇을 승인했으며 그래서 무엇이 실행됐는가"를
 * 재구성하려고 두 로그를 시각으로 꿰맞춰야 한다.
 *
 * **현재 상태 (읽는 사람이 오해하지 않도록):** `OperationExecutor`는 실행 항목
 * (`allowed`/`denied`/`failed`)만 기록한다. 수명주기 네 값은 **아직 아무도
 * 쓰지 않는다** — 제안을 만드는 쪽은 Phase 6의 AI 오케스트레이터이고,
 * 승인·거부를 사용자 행동으로 기록하는 쪽은 0c의 승인 UI다. 지금 감사 로그만
 * 보고 "제안 → 승인 → 실행"을 재구성할 수는 없다. 그 배선이 끝나기 전에는
 * 이 로그로 AI 쓰기 흐름을 감사한다고 말하면 안 된다.
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
  /**
   * 실패 원인. **드라이버 원문 오류를 그대로 넣지 말 것** — 엔진에 따라 오류
   * 메시지에 위반한 행의 값이 실려 온다(제약 위반 시 컬럼 값 등). 감사 로그는
   * 사용자가 열어보는 것이고, 자격증명을 기록하지 않는 것과 같은 이유로
   * 데이터도 새면 안 된다. 요약된 형태로만 넣는다.
   */
  readonly errorMessage?: string
  /**
   * 이 항목이 속한 쓰기 제안서. 제안 → 승인 → 실행이 각각 별도 항목으로
   * 남으므로, **어느 제안이 실행됐는지 판별하는 유일한 식별자**다.
   *
   * `statementHash`로는 부족하다: 해시는 내용만의 함수라, 같은 문장을 두 번
   * 제안해 하나는 승인되고 하나는 거부되면 두 흐름이 구분되지 않는다.
   */
  readonly proposalId?: string
  /**
   * 제안서의 `statementHash`. 제안 → 승인 → 실행이 서로 다른 항목으로 남으므로,
   * 이 값이 있어야 "사용자가 승인한 그 문장이 실행됐다"를 로그만 보고 대조할 수
   * 있다.
   */
  readonly statementHash?: string
  /**
   * 실행에 걸린 시간. 제안·승인·거부·만료처럼 실행이 아닌 항목에는 없다 —
   * 필수로 두면 호출자가 의미 없는 `0`을 지어내야 한다.
   */
  readonly durationMs?: number
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
  /**
   * 용량 초과로 버려진 항목 수.
   *
   * 이게 없으면 손실이 **조용하다**. 감사 로그에서 조용한 손실은 치명적이다:
   * AI는 거부되는 요청을 무제한 만들어 낼 수 있고(거부도 한 항목을 쓴다),
   * 축출은 오래된 것부터이므로, 충분히 많은 거부를 유발하면 그 이전의 기록 —
   * 승인받아 실행된 파괴적 쓰기를 포함해 — 이 전부 밀려난다. 그리고 조회자가
   * 보는 화면은 "이게 전부다"와 구분되지 않는다.
   *
   * 이 값을 노출해도 손실 자체를 막지는 못한다. 손실을 **보이게** 만들 뿐이다.
   * 진짜 해법은 0c의 append-only 파일 백엔드다.
   */
  droppedCount(): number
}
