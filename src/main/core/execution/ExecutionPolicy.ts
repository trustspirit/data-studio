import {
  DEFAULT_AI_LIMITS,
  DEFAULT_USER_LIMITS,
  resolveLimits,
  type ExecutionLimits,
  type Operation,
} from '../../../shared/types/operation'
import type { StatementClassification } from '../driver/capabilities/SqlCapability'
import { classifyStatement, splitStatements } from './StatementClassifier'
import type { Actor } from './Actor'

export type DenialReason =
  | 'ai_write_requires_proposal'
  | 'ai_multi_statement'
  | 'ai_read_only_unsupported'
  | 'capability_missing'

export type PolicyDecision =
  | { readonly allow: true; readonly limits: ExecutionLimits; readonly readOnlyScope: boolean }
  | { readonly allow: false; readonly reason: DenialReason }

export interface PolicyInput {
  readonly actor: Actor
  readonly operation: Operation
  readonly hasSql: boolean
  readonly hasSchema: boolean
  /** 드라이버가 `beginReadOnly`를 구현하는가 */
  readonly supportsReadOnlyScope: boolean
  /** 드라이버의 엔진 고유 분류 */
  readonly driverClassify: (sql: string) => StatementClassification
  readonly requestedLimits: Partial<ExecutionLimits> | undefined
}

function deny(reason: DenialReason): PolicyDecision {
  return { allow: false, reason }
}

/**
 * 두 분류를 합친다. **둘 중 하나라도 `read`가 아니면 읽기가 아니다.**
 *
 * 공통 층(StatementClassifier)은 엔진 독립 우회 케이스를, 드라이버 층은 엔진
 * 고유 문법을 안다. 한쪽만 믿으면 다른 쪽이 아는 것을 놓친다.
 */
function combine(a: StatementClassification, b: StatementClassification): StatementClassification {
  if (a === 'read' && b === 'read') return 'read'
  if (a === 'write' || b === 'write') return 'write'
  return 'unknown'
}

/**
 * 단일 정책 판정. 모든 실행 경로가 여기를 지난다.
 *
 * 사용자와 AI를 가르는 지점이 하나뿐이어야 한다 — 경로마다 판정이 흩어지면
 * 한 곳만 빠뜨려도 AI가 승인 없이 쓰게 된다.
 */
export function decide(input: PolicyInput): PolicyDecision {
  const { actor, operation } = input

  if (operation.kind === 'schema') {
    if (!input.hasSchema) return deny('capability_missing')
    // 메타데이터 조회는 데이터를 바꾸지 않는다. 읽기 전용 트랜잭션을
    // 지원하지 않는 엔진에서도 AI에게 허용한다.
    return {
      allow: true,
      limits: actor.type === 'ai' ? aiLimits(input) : userLimits(input),
      readOnlyScope: false,
    }
  }

  if (!input.hasSql) return deny('capability_missing')

  if (actor.type === 'user') {
    // 사용자가 직접 친 문장은 그 자체가 의도 표명이다. 승인 게이트는 AI 경로의
    // 통제이지 사용자에 대한 통제가 아니다.
    return { allow: true, limits: userLimits(input), readOnlyScope: false }
  }

  // --- 여기부터 AI 경로 ---

  if (splitStatements(operation.sql).length > 1) return deny('ai_multi_statement')

  if (!input.supportsReadOnlyScope) {
    // 스펙 §4.2 2층. DB 수준 강제가 없으면 구문 분류만 남는데, 그것만으로는
    // 읽기 전용을 보장할 수 없다 — 그래서 기능 자체를 끈다.
    return deny('ai_read_only_unsupported')
  }

  const classification = combine(
    classifyStatement(operation.sql),
    input.driverClassify(operation.sql),
  )

  // 'unknown'은 쓰기로 취급한다(fail-safe). 확신할 수 없는 문장을 AI가
  // 자율 실행하게 두는 것이 정확히 막으려는 상황이다.
  if (classification !== 'read') return deny('ai_write_requires_proposal')

  return { allow: true, limits: aiLimits(input), readOnlyScope: true }
}

function userLimits(input: PolicyInput): ExecutionLimits {
  return resolveLimits(DEFAULT_USER_LIMITS, input.requestedLimits)
}

function aiLimits(input: PolicyInput): ExecutionLimits {
  return resolveLimits(DEFAULT_AI_LIMITS, input.requestedLimits)
}
