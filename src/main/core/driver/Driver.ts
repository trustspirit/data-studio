import type { ConnectionConfig, EngineId } from '../../../shared/types/connection'
import type { SqlCapability } from './capabilities/SqlCapability'
import type { SchemaCapability } from './capabilities/SchemaCapability'
import type { DataCapability } from './capabilities/DataCapability'

/**
 * 하나의 데이터소스 연결.
 *
 * **능력은 선택적 객체 프로퍼티로 노출한다.** 문자열 Set + 타입 가드
 * (`capabilities.has('sql')`로 `d is Driver & SqlCapability`를 단언하는 방식)를
 * 쓰지 않는 이유: Set에 'sql'을 넣고 execute를 구현하지 않은 드라이버가 있어도
 * 컴파일이 통과하고 런타임에 터진다. 프로퍼티 존재 자체가 능력의 증거이면
 * 타입 시스템이 실제로 검증한다.
 *
 * 새 능력(documents, keyValue, stream)은 선택적 프로퍼티를 하나 더 다는 것으로
 * 끝난다 — 기존 드라이버와 상위 코드는 바뀌지 않는다.
 */
export interface Driver {
  readonly id: string
  readonly engine: EngineId

  /**
   * 커넥션을 연다.
   *
   * **`config.id`는 반드시 이 드라이버의 `id`와 같아야 한다.** 다르면 던진다.
   * `PooledConnectionManager`는 `config.id`로 항목을 키잉하고 그 항목의
   * `driver`를 내주므로, 둘이 어긋나면 A 커넥션으로 요청한 질의가 B 서버에서
   * 실행되면서 아무 에러도 나지 않는다 — 맞아 보이는 틀린 데이터가 나가는
   * 형태의 실패다.
   */
  connect(config: ConnectionConfig): Promise<void>
  disconnect(): Promise<void>
  /** 왕복 지연을 밀리초로 돌려준다. */
  ping(): Promise<number>

  readonly sql?: SqlCapability
  readonly schema?: SchemaCapability
  readonly data?: DataCapability
}

/** IPC로 renderer에 내려보내는 능력 식별자. */
export type Capability = 'sql' | 'schema' | 'data'
