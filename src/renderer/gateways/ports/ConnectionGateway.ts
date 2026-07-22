import type { ConnectionConfig } from '../../../shared/types/connection'

/** 커넥션의 실시간 연결 상태. */
export type ConnectionStatus = 'closed' | 'connecting' | 'ready' | 'error'

/** `open` 호출 결과. 실패해도 예외가 아니라 이 값으로 사유를 준다. */
export type OpenResult =
  | { readonly opened: true }
  | { readonly opened: false; readonly reason: string }

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
  /** 실제 DB 연결을 연다. */
  open(connectionId: string): Promise<OpenResult>
  /** 실제 DB 연결을 닫는다. */
  close(connectionId: string): Promise<void>
  /** 커넥션의 현재 연결 상태를 조회한다. */
  status(connectionId: string): Promise<ConnectionStatus>
  /** 파일 선택 다이얼로그를 열어 경로를 받는다(취소 시 null). SQLite 파일 선택용. */
  openFileDialog(): Promise<string | null>
}

/** secret 저장소가 재시작 후에도 값을 유지하는지. */
export interface SecretsStatus {
  readonly persistent: boolean
}
