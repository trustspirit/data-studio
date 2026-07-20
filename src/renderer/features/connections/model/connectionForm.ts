import {
  connectionConfigSchema,
  type ConnectionConfig,
  type EngineId,
} from '@shared/types/connection'
import { DEFAULT_PORTS } from './enginePorts'

/** 빈 새 연결 초안. id는 호출마다 새로 만든다. */
export function emptyDraft(): ConnectionConfig {
  return {
    id: crypto.randomUUID(),
    name: '',
    engine: 'postgres',
    host: '',
    port: 5432,
    database: '',
    username: '',
    tlsMode: 'disable',
    aiReadOnlyUsername: null,
    maskedColumnPatterns: [],
  }
}

/**
 * 엔진을 바꾸고, 포트가 "손대지 않은" 상태(0이거나 이전 엔진의 기본값)일 때만
 * 새 엔진 기본 포트로 채운다. 사용자가 직접 넣은 포트는 보존한다.
 */
export function applyEngine(draft: ConnectionConfig, engine: EngineId): ConnectionConfig {
  const oldDefault = DEFAULT_PORTS[draft.engine] ?? 0
  const untouched = draft.port === 0 || draft.port === oldDefault
  const nextPort = untouched ? (DEFAULT_PORTS[engine] ?? 0) : draft.port
  return { ...draft, engine, port: nextPort }
}

export type ValidationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly errors: Readonly<Record<string, string>> }

/**
 * 기존 `connectionConfigSchema`로 검증한다 — 필드 규칙을 두 번 적지 않는다.
 * 첫 issue만 필드별로 매핑한다(필드당 한 메시지).
 */
export function validateDraft(draft: ConnectionConfig): ValidationResult {
  const parsed = connectionConfigSchema.safeParse(draft)
  if (parsed.success) return { ok: true }

  const errors: Record<string, string> = {}
  for (const issue of parsed.error.issues) {
    const key = issue.path[0]
    if (typeof key === 'string' && !(key in errors)) {
      errors[key] = issue.message
    }
  }
  return { ok: false, errors }
}
