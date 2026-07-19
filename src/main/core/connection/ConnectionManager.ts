import type { ConnectionConfig } from '../../../shared/types/connection'
import type { Driver } from '../driver/Driver'

export type ConnectionStatus = 'closed' | 'connecting' | 'ready' | 'error'

/**
 * 풀에서 임차한 커넥션. 반드시 `release()`로 반납해야 한다 —
 * 반납하지 않으면 동시 실행 슬롯이 영구히 잠긴다.
 *
 * `release()`는 몇 번을 불러도 슬롯을 한 번만 돌려준다. 중복 반납을 허용하면
 * 슬롯 회계가 실제보다 커져서 동시 실행 제한이 조용히 무력화된다.
 */
export interface LeasedConnection {
  readonly driver: Driver
  /**
   * 이 임차가 더 이상 유효하지 않을 때 발화한다 — 지금은 커넥션이 닫힐 때다.
   *
   * 없으면 close가 진행 중인 작업에 아무것도 알리지 못한다. 임차자는 끊긴
   * 드라이버를 손에 쥔 채 계속 돌고, `release()`는 아무 반응이 없으며,
   * 사용자는 커넥션을 닫았는데 질의가 살아 있다. 이 signal을
   * `ExecutionContext.signal`과 합치면 close가 곧 취소가 된다.
   */
  readonly signal: AbortSignal
  release(): void
}

/**
 * 커넥션의 수명(생성·연결·재사용·폐기)과 커넥션당 동시 실행 제한을 소유한다.
 *
 * `DriverRegistry.create`는 부를 때마다 새 드라이버를 만들고 `connect`/`disconnect`를
 * 부르지 않는다. 그 수명 관리가 이 포트의 존재 이유다.
 */
export interface ConnectionManager {
  /**
   * 커넥션을 열고 드라이버를 준비시킨다.
   *
   * - 이미 열려 있고 config가 **같으면** 아무것도 하지 않는다. 드라이버를 다시
   *   만들지 않고 `connect`도 다시 부르지 않는다.
   * - 이미 열려 있는데 config가 **다르면** `ConnectionConfigChangedError`로
   *   거부한다. 조용히 무시하면 사용자가 host나 database를 고쳐 다시 연결한 뒤
   *   옛 서버의 답을 새 설정의 답으로 착각한다 — 맞아 보이는 틀린 데이터가
   *   나가는 쪽이 거부당하는 쪽보다 훨씬 나쁘다. 설정을 바꾸려면 `close` 후
   *   다시 열어야 하고, 이 에러가 그 사실을 알려 준다.
   * - 같은 id로 연결이 진행 중이면 그 진행 중인 작업을 함께 기다린다.
   *   동시 호출이 몇 개든 `connect`는 정확히 한 번만 돈다.
   * - `connect`가 실패하면 상태는 `error`가 되고 에러를 그대로 던진다.
   *   실패한 연결은 성공으로 캐시되지 않으며, 다시 `open`을 부르면 재시도한다.
   */
  open(config: ConnectionConfig): Promise<void>
  /**
   * 슬롯이 빌 때까지 기다렸다가 커넥션을 임차한다.
   *
   * 상태가 `ready`가 아니면(`closed`/`connecting`/`error`) 즉시
   * `ConnectionNotOpenError`로 거부한다. 대기가 설정된 타임아웃을 넘으면
   * `AcquireTimeoutError`로 거부하고, 그 대기자는 큐에서 빠진다.
   *
   * **여기서 `ping`을 하지 않는다.** 임차마다 왕복을 한 번 더 넣으면 모든
   * 질의에 지연이 붙는다. 생존 확인은 `checkHealth`로 명시적으로 한다.
   */
  acquire(connectionId: string): Promise<LeasedConnection>
  /**
   * 커넥션을 닫고 드라이버를 폐기한다.
   *
   * **즉시 끊는다 — 아직 반납되지 않은 임차를 기다리지 않는다.** 사용자가 닫기를
   * 눌렀는데 실행 중인 질의가 끝날 때까지 매달려 있으면 앱이 멈춘 것처럼 보인다.
   * 반납되지 않은 임차의 드라이버는 끊긴 상태가 되며, 그 임차를 나중에 반납해도
   * 아무 효과가 없다(이미 폐기된 항목에 슬롯을 돌려주지 않는다).
   *
   * 대기 중인 요청은 `ConnectionNotOpenError`로 거부한다. 열려 있지 않은 id에
   * 대해서는 아무것도 하지 않는다 — 중복 호출은 안전하고 `disconnect`는 한 번만 돈다.
   */
  close(connectionId: string): Promise<void>
  /** 열려 있는 모든 커넥션을 닫는다. 앱 종료 경로용. */
  closeAll(): Promise<void>
  status(connectionId: string): ConnectionStatus
  /**
   * `ping`으로 생존을 확인한다. 성공하면 true.
   *
   * 실패하면 상태를 `error`로 내리고 false를 돌려준다 — **조용히 다시 연결하지
   * 않는다.** 죽은 커넥션을 몰래 갈아끼우면 세션에 매달린 상태(임시 테이블,
   * 열린 트랜잭션, SET)가 말없이 사라져서, 이어지는 질의가 틀린 답을 맞는 답처럼
   * 돌려준다. 되살릴지는 `close`/`open`을 부르는 호출자가 판단한다.
   *
   * 열려 있지 않거나 `ready`가 아닌 id는 `ping` 없이 false다.
   */
  checkHealth(connectionId: string): Promise<boolean>
}
