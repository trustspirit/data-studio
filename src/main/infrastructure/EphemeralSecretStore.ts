import {
  secretKey,
  type SecretRef,
  type SecretStore,
} from '../core/ports/SecretStore'

/**
 * 플랫폼이 안전한 암호화를 제공하지 못할 때 쓰는 세션 한정 저장소.
 * 디스크에 아무것도 쓰지 않는다.
 */
export class EphemeralSecretStore implements SecretStore {
  private readonly values = new Map<string, string>()

  isPersistent(): boolean {
    return false
  }

  async set(ref: SecretRef, value: string): Promise<void> {
    this.values.set(secretKey(ref), value)
  }

  async get(ref: SecretRef): Promise<string | null> {
    return this.values.get(secretKey(ref)) ?? null
  }

  async delete(ref: SecretRef): Promise<void> {
    this.values.delete(secretKey(ref))
  }
}
