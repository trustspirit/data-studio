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
}

/** secret 저장소가 재시작 후에도 값을 유지하는지. */
export interface SecretsStatus {
  readonly persistent: boolean
}
