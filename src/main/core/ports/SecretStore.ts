/**
 * 'db-password-ai-readonly'는 ConnectionConfig.aiReadOnlyUsername으로 만든
 * 두 번째 DB 계정의 비밀번호다. 커넥션당 사람 계정과 AI 계정이 별도로 존재하므로
 * 별도의 SecretKind가 필요하다 — 그렇지 않으면 ownerId(커넥션 id)가 같아
 * secretKey()가 두 비밀번호를 같은 키로 겹쳐 쓴다.
 */
export type SecretKind = 'db-password' | 'db-password-ai-readonly' | 'llm-api-key' | 'tls-client-key'

export interface SecretRef {
  readonly kind: SecretKind
  readonly ownerId: string
}

export interface SecretStore {
  /**
   * 이 저장소가 재시작 이후에도 값을 유지하는지.
   * false면 UI가 "재시작 시 다시 입력해야 함"을 사용자에게 알려야 한다.
   */
  isPersistent(): boolean
  set(ref: SecretRef, value: string): Promise<void>
  get(ref: SecretRef): Promise<string | null>
  delete(ref: SecretRef): Promise<void>
}

export function secretKey(ref: SecretRef): string {
  return `${ref.kind}:${ref.ownerId}`
}
