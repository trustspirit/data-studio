import type { ExecutionContext } from '../ExecutionContext'
import type { PageRequest, ResultSet } from '@shared/types/resultSet'

/** 라이브 스트림 메시지 한 건. `meta`는 엔진 좌표(kafka partition/offset 등). */
export interface StreamMessage {
  readonly key: string | null
  readonly value: string
  readonly timestamp: number | null
  readonly meta: Readonly<Record<string, string | number>>
}

/** hub가 드라이버에 넘기는 싱크. 드라이버는 메시지 도착 시 emit을 호출한다. */
export interface StreamMessageSink {
  emit(messages: readonly StreamMessage[]): void
}

/** 활성 구독 핸들. stop은 consumer 정리 + 브로커 연결 해제. */
export interface StreamHandle {
  stop(): Promise<void>
}

export interface StreamSubscribeReq {
  readonly topic: string
  readonly from: 'latest' | 'earliest'
}

/**
 * 스트리밍(Kafka/RabbitMQ) 능력. v1은 읽기 전용이다(listTopics + subscribe tail).
 *
 * subscribe는 표가 아니라 장수명 핸들을 돌려주며, 메시지는 sink.emit으로 밀어 넣는다 —
 * StreamHub가 sink를 제공하고 백프레셔·push를 담당한다. produce(쓰기)/commit은 후속.
 */
export interface StreamCapability {
  listTopics(ctx: ExecutionContext, page: PageRequest): Promise<ResultSet>
  subscribe(ctx: ExecutionContext, req: StreamSubscribeReq, sink: StreamMessageSink): Promise<StreamHandle>
}
