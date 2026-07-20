import type { ConnectionConfig } from '../../../shared/types/connection'

/**
 * feature가 커넥션을 다룰 때 의존하는 인터페이스.
 *
 * feature는 IPC 형태(`ok`/`code`)를 몰라야 한다 — 게이트웨이가 그것을 풀어
 * 값이나 도메인 오류로 바꾼다. 구현체는 renderer 조립 지점에서 주입한다.
 */
export interface ConnectionGateway {
  list(): Promise<ConnectionConfig[]>
  save(config: ConnectionConfig): Promise<void>
  delete(id: string): Promise<void>
  /** 연결의 DB 비밀번호를 저장/교체한다. write-only — 되읽는 메서드는 없다. */
  setSecret(connectionId: string, value: string): Promise<void>
  /** 연결에 DB 비밀번호가 저장돼 있는지. 값이 아니라 존재 여부만 준다. */
  hasSecret(connectionId: string): Promise<boolean>
  /** 비밀 저장소가 재시작 후에도 값을 유지하는지. */
  secretsPersistent(): Promise<boolean>
}

/** secret 저장소가 재시작 후에도 값을 유지하는지. */
export interface SecretsStatus {
  readonly persistent: boolean
}
