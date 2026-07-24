import type { ColumnDescriptor } from './resultSet'
import type { WireValue } from './wire'

/**
 * 라이브 스트림 한 배치. columns/rows는 기존 wire 표현을 재사용해 renderer가
 * 표로 렌더한다. `droppedSince`는 직전 push 이후 백프레셔로 버려진 메시지 수다
 * (UI가 "N dropped"로 표시).
 */
export interface StreamBatch {
  readonly columns: readonly ColumnDescriptor[]
  readonly rows: readonly (readonly WireValue[])[]
  readonly droppedSince: number
  readonly closed?: boolean
}

/** push 채널 `stream:message`의 페이로드. subscriptionId로 renderer가 자기 구독만 필터. */
export interface StreamPushMessage {
  readonly subscriptionId: string
  readonly batch: StreamBatch
}
