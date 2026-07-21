import type { PageRequest } from './resultSet'

/** SQL 문장 실행. `params`는 위치 기반이다. */
export interface SqlOperation {
  readonly kind: 'sql'
  readonly sql: string
  readonly params?: readonly unknown[]
}

/** 스키마 메타데이터 조회. 어떤 엔진에도 데이터 변경을 일으키지 않는다. */
export type SchemaOperationOp =
  | { readonly op: 'listSchemas' }
  | { readonly op: 'listTables'; readonly schema: string }
  | { readonly op: 'describeTable'; readonly schema: string; readonly table: string }
  | { readonly op: 'listIndexes'; readonly schema: string; readonly table: string }
  | { readonly op: 'listForeignKeys'; readonly schema: string; readonly table: string }

export type SchemaOperation = { readonly kind: 'schema' } & SchemaOperationOp

/**
 * 실행 요청. 판별 유니온이므로 document/keyvalue/stream은 해당 드라이버가
 * 생길 때 순수 확장으로 추가한다 — 소비자 없이 지금 설계하지 않는다.
 */
export type Operation = SqlOperation | SchemaOperation

export interface ExecutionLimits {
  /** 엔진 네이티브 statement timeout */
  readonly timeoutMs: number
  readonly maxRows: number
  readonly maxBytes: number
}

/** 스펙 §4.4 기본값 */
export const DEFAULT_USER_LIMITS: ExecutionLimits = {
  timeoutMs: 30_000,
  maxRows: 1_000,
  maxBytes: 8 * 1024 * 1024,
}

export const DEFAULT_AI_LIMITS: ExecutionLimits = {
  timeoutMs: 10_000,
  maxRows: 1_000,
  maxBytes: 8 * 1024 * 1024,
}

export interface OperationRequest {
  /** 취소·추적용. 호출자가 만든다. */
  readonly requestId: string
  readonly connectionId: string
  readonly operation: Operation
  readonly page?: PageRequest
  readonly limits?: Partial<ExecutionLimits>
}

function tighten(base: number, requested: number | undefined): number {
  // 0이나 음수는 "제한 없음"이 아니라 무의미한 값이다. maxRows: 0이면 한 행도
  // 못 돌려주면서 커서도 전진하지 않아 호출자가 무한 루프에 빠진다.
  if (requested === undefined || !Number.isFinite(requested) || requested <= 0) return base
  return Math.min(base, requested)
}

/**
 * 요청된 제한을 기본값 **이내로만** 받아들인다.
 *
 * 항상 `Math.min`이다: renderer가 보낸 값이 기본값을 넘으면 그 값 하나로 제한
 * 전체가 무의미해진다. 요청은 제한을 **더 엄격하게만** 만들 수 있다.
 */
export function resolveLimits(
  base: ExecutionLimits,
  requested: Partial<ExecutionLimits> | undefined,
): ExecutionLimits {
  return {
    timeoutMs: tighten(base.timeoutMs, requested?.timeoutMs),
    maxRows: tighten(base.maxRows, requested?.maxRows),
    maxBytes: tighten(base.maxBytes, requested?.maxBytes),
  }
}
