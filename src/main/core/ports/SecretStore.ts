export type SecretKind = 'db-password' | 'llm-api-key' | 'tls-client-key'

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
